import { randomUUID } from "node:crypto"
import { defaultLogger, toResult } from "@coinzilla/utils"
import { isValidEventName } from "./helpers/event-name.js"
import { assertSupportedPayload, cloneAndFreezePayload } from "./helpers/payload.js"
import { validateOptions } from "./helpers/options.js"
import { canAcceptDeliveries } from "./helpers/delivery-capacity.js"

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

  publish({ name, source, data = {} } = {}) {
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

  subscribe({ name, handler } = {}) {
    if (!isValidEventName(name)) {
      return toResult({
        error: new TypeError("Event name must be 1-128 characters, start with a letter, number, or underscore, and contain only letters, numbers, _, ., :, or -"),
      })
    }

    return this.addSubscription({ name, handler })
  }

  subscribeAll({ handler } = {}) {
    return this.addSubscription({
      name: ALL_EVENTS,
      handler,
    })
  }

  addSubscription({ name, handler } = {}) {
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

  async close({} = {}) {
    if (this.closed) {
      const result = await this.flush()
      return result.ok
        ? toResult({ closed: true })
        : toResult({ error: new Error("Failed to flush EventBus") })
    }

    this.closed = true

    const result = await this.flush()

    if (!result.ok) {
      return result
    }

    for (const record of this.subscriptions) {
      record.active = false
      record.registry.delete(record.listener)
    }

    this.subscriptions.clear()
    this.listeners.clear()
    this.allListeners.clear()

    return toResult({ closed: true })
  }
}
