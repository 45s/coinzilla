import { randomUUID } from "node:crypto"
import { defaultLogger, toResult } from "@coinzilla/utils"
import { isValidEventName } from "./helpers/event-name.js"
import { assertSupportedPayload, cloneAndFreezePayload } from "./helpers/payload.js"
import { validateOptions } from "./helpers/options.js"
import { canAcceptDeliveries } from "./helpers/delivery-capacity.js"
import { assertObjectInput } from "./helpers/object-input.js"

const ALL_EVENTS = Symbol("all-events")
export class EventBus {
  /**
   * @param {{ logger?: { error?: (entry: object) => void }, onError?: (context: object) => void | Promise<void>, maxPending?: number }} options
   * @throws {TypeError} If options or a configured callback is invalid.
   */
  constructor(options = {}) {
    const { logger, onError, maxPending } = validateOptions(options, defaultLogger)
    this.logger = logger
    this.onError = onError
    this.maxPending = maxPending
    // Use an explicit registry rather than EventEmitter: event names are
    // application data and must never trigger Node's special listener events.
    this.listeners = new Map()
    this.allListeners = new Set()
    this.subscriptions = new Set()
    this.pending = new Set()
    this.closed = false
  }

  publish(input = {}) {
    let name
    let source
    let data

    try {
      assertObjectInput(input, "Event publish")
      ;({ name, source, data = {} } = input)
    } catch (error) {
      return toResult({ error })
    }

    if (this.closed) {
      return toResult({
        error: new Error("EventBus is closed"),
      })
    }

    if (!isValidEventName(name)) {
      return toResult({
        error: new TypeError("Event name must be 1-128 characters, start with a letter, number, or underscore, and contain only letters, numbers, _, ., :, or -"),
      })
    }

    if (typeof source !== "string" || source.trim() === "") {
      return toResult({
        error: new TypeError("Event source must be a non-empty string"),
      })
    }

    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return toResult({
        error: new TypeError("Event data must be an object"),
      })
    }

    let eventData

    try {
      assertSupportedPayload(data)
      eventData = cloneAndFreezePayload(data)
    } catch (error) {
      return toResult({ error })
    }

    const listeners = [
      ...(this.listeners.get(name) ?? []),
      ...this.allListeners,
    ]

    if (!canAcceptDeliveries({
      pendingCount: this.pending.size,
      deliveryCount: listeners.length,
      maxPending: this.maxPending,
    })) {
      return toResult({
        error: new Error("EventBus pending delivery limit exceeded"),
      })
    }

    const event = Object.freeze({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      name,
      source,
      data: eventData,
    })

    for (const listener of listeners) {
      listener(event)
    }

    return toResult({ event })
  }

  subscribe(input = {}) {
    let name
    let handler

    try {
      assertObjectInput(input, "Event subscription")
      ;({ name, handler } = input)
    } catch (error) {
      return toResult({ error })
    }

    if (!isValidEventName(name)) {
      return toResult({
        error: new TypeError("Event name must be 1-128 characters, start with a letter, number, or underscore, and contain only letters, numbers, _, ., :, or -"),
      })
    }

    return this.addSubscription({ name, handler })
  }

  subscribeAll(input = {}) {
    let handler

    try {
      assertObjectInput(input, "Event subscribeAll")
      ;({ handler } = input)
    } catch (error) {
      return toResult({ error })
    }

    return this.addSubscription({
      name: ALL_EVENTS,
      handler,
    })
  }

  addSubscription(input = {}) {
    let name
    let handler

    try {
      assertObjectInput(input, "Event subscription")
      ;({ name, handler } = input)
    } catch (error) {
      return toResult({ error })
    }

    if (this.closed) {
      return toResult({
        error: new Error("EventBus is closed"),
      })
    }

    if (typeof handler !== "function") {
      return toResult({
        error: new TypeError("Event handler must be a function"),
      })
    }

    const listener = (event) => {
      let task

      task = Promise.resolve()
        .then(() => handler(event))
        .catch(async (error) => {
          try {
            if (this.onError) {
              await this.onError({
                error,
                event,
                eventName: event.name,
              })
            } else {
              this.logger.error?.({
                message: "Event consumer failed",
                error,
                eventId: event.id,
                eventName: event.name,
                source: event.source,
              })
            }
          } catch (reportingError) {
            process.emitWarning(
              `EventBus error reporting failed: ${reportingError.message}`,
            )
          }
        })
        .finally(() => {
          this.pending.delete(task)
        })

      this.pending.add(task)
    }

    const registry = name === ALL_EVENTS
      ? this.allListeners
      : this.getListeners(name)

    registry.add(listener)

    const record = { registry, listener, active: true }
    this.subscriptions.add(record)

    const subscription = {
      unsubscribe: () => {
        if (!record.active) {
          return toResult({ unsubscribed: false })
        }

        record.active = false
        record.registry.delete(record.listener)
        this.subscriptions.delete(record)

        if (name !== ALL_EVENTS && record.registry.size === 0) {
          this.listeners.delete(name)
        }

        return toResult({ unsubscribed: true })
      },
    }

    return toResult({ subscription })
  }

  getListeners(name) {
    let listeners = this.listeners.get(name)

    if (!listeners) {
      listeners = new Set()
      this.listeners.set(name, listeners)
    }

    return listeners
  }

  async flush({} = {}) {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending])
    }

    return toResult({ flushed: true })
  }

  /**
   * Return an immutable snapshot of the bus's current resource and lifecycle state.
   * @returns {{ pendingCount: number, maxPending: number, closed: boolean }}
   */
  getDiagnostics() {
    return Object.freeze({
      pendingCount: this.pending.size,
      maxPending: this.maxPending,
      closed: this.closed,
    })
  }

  #clearSubscriptions() {
    for (const record of this.subscriptions) {
      record.active = false
      record.registry.delete(record.listener)
    }

    this.subscriptions.clear()
    this.listeners.clear()
    this.allListeners.clear()
  }

  /**
   * Stop accepting work and wait for accepted deliveries to settle.
   * When timeoutMs expires, the bus remains closed and pending handlers continue
   * running; a later close() call can wait for them to drain.
   * @param {{ timeoutMs?: number }} options (1–2,147,483,647 milliseconds when provided)
   */
  async close(options = {}) {
    if (
      options === null ||
      typeof options !== "object" ||
      Array.isArray(options) ||
      (Object.getPrototypeOf(options) !== Object.prototype &&
        Object.getPrototypeOf(options) !== null)
    ) {
      return toResult({
        error: new TypeError("EventBus close options must be a plain object"),
      })
    }

    for (const key of Reflect.ownKeys(options)) {
      if (key !== "timeoutMs") {
        return toResult({
          error: new TypeError(`Unknown EventBus close option: ${String(key)}`),
        })
      }
    }

    const { timeoutMs } = options
    if (
      timeoutMs !== undefined &&
      (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    ) {
      return toResult({
        error: new TypeError("EventBus close timeoutMs must be an integer between 1 and 2147483647"),
      })
    }

    this.closed = true

    let result
    if (timeoutMs === undefined) {
      result = await this.flush()
    } else {
      let timeoutHandle
      const timeout = new Promise((resolve) => {
        timeoutHandle = setTimeout(() => resolve(null), timeoutMs)
      })

      try {
        result = await Promise.race([this.flush(), timeout])
      } finally {
        clearTimeout(timeoutHandle)
      }

      if (result === null) {
        this.#clearSubscriptions()
        return toResult({
          error: new Error(`EventBus close timed out after ${timeoutMs}ms`),
          timedOut: true,
        })
      }
    }

    if (!result.ok) {
      return result
    }

    this.#clearSubscriptions()
    return toResult({ closed: true })
  }
}
