import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { defaultLogger, toResult } from "@coinzilla/utils"

const ALL_EVENTS = Symbol("all-events")

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value
  }

  seen.add(value)

  if (value instanceof Map) {
    for (const [key, child] of value) {
      deepFreeze(key, seen)
      deepFreeze(child, seen)
    }

    Object.defineProperties(value, {
      set: {
        value() {
          throw new TypeError("Cannot mutate frozen event data")
        },
      },
      delete: {
        value() {
          throw new TypeError("Cannot mutate frozen event data")
        },
      },
      clear: {
        value() {
          throw new TypeError("Cannot mutate frozen event data")
        },
      },
    })

    return Object.freeze(value)
  }

  if (value instanceof Set) {
    for (const child of value) {
      deepFreeze(child, seen)
    }

    Object.defineProperties(value, {
      add: {
        value() {
          throw new TypeError("Cannot mutate frozen event data")
        },
      },
      delete: {
        value() {
          throw new TypeError("Cannot mutate frozen event data")
        },
      },
      clear: {
        value() {
          throw new TypeError("Cannot mutate frozen event data")
        },
      },
    })

    return Object.freeze(value)
  }

  for (const child of Object.values(value)) {
    deepFreeze(child, seen)
  }

  return Object.freeze(value)
}

export class EventBus {
  constructor({ logger = defaultLogger, onError } = {}) {
    this.logger = logger
    this.onError = onError
    this.emitter = new EventEmitter()
    // Node treats an unhandled "error" event as an exception. The event bus
    // accepts arbitrary event names, so keep publishing "error" safe even
    // when no consumer subscribes to it.
    this.emitter.on("error", () => {})
    this.pending = new Set()
    this.closed = false
  }

  publish({ name, source, data = {} } = {}) {
    if (this.closed) {
      return toResult({
        error: new Error("EventBus is closed"),
      })
    }

    if (typeof name !== "string" || name.trim() === "") {
      return toResult({
        error: new TypeError("Event name must be a non-empty string"),
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
      eventData = deepFreeze(structuredClone(data))
    } catch (error) {
      return toResult({ error })
    }

    const event = Object.freeze({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      name,
      source,
      data: eventData,
    })

    this.emitter.emit(name, event)
    this.emitter.emit(ALL_EVENTS, event)

    return toResult({ event })
  }

  subscribe({ name, handler } = {}) {
    if (typeof name !== "string" || name.trim() === "") {
      return toResult({
        error: new TypeError("Event name must be a non-empty string"),
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
              this.logger.error?.("Event consumer failed", {
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

    this.emitter.on(name, listener)

    let subscribed = true

    const subscription = {
      unsubscribe: () => {
        if (!subscribed) {
          return toResult({ unsubscribed: false })
        }

        subscribed = false
        this.emitter.off(name, listener)

        return toResult({ unsubscribed: true })
      },
    }

    return toResult({ subscription })
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

    this.emitter.removeAllListeners()

    return toResult({ closed: true })
  }
}
