import { defaultLogger, toResult } from "@coinzilla/utils"

/**
 * Create the application-facing EventBus publisher and a durable flush barrier.
 *
 * Publication is synchronous admission only. flush() waits for subscribers
 * (including Journal) to persist all accepted events.
 *
 * @param {{ eventBus: { publish: (event: object) => object }, flush?: () => Promise<object>, logger?: { error?: (entry: object) => void } }} input
 * @returns {{ publish: (event: object) => object, flush: () => Promise<object> }}
 */
export function makeEventPublisher({ eventBus, flush: flushEvents, logger = defaultLogger } = {}) {
  const reportFailure = ({ event, error }) => {
    try {
      logger?.error?.({
        message: "Harvester event publication failed",
        eventName: event?.name,
        error,
      })
    } catch {
      // Diagnostics must never turn an optional observer failure into an
      // application or trading failure.
    }
  }

  const publish = (event = {}) => {
    try {
      const result = eventBus.publish(event)
      if (result?.ok === true) return result

      const errors = Array.isArray(result?.errors) && result.errors.length > 0
        ? result.errors
        : [new Error("EventBus publication failed without error details")]
      const failure = toResult({ errors })
      reportFailure({ event, error: failure.errors[0] })
      return failure
    } catch (error) {
      const failure = toResult({ error })
      reportFailure({ event, error })
      return failure
    }
  }

  const flush = async () => {
    if (typeof flushEvents !== "function") {
      return toResult({ error: new TypeError("Harvester event publisher has no durable flush capability") })
    }
    try {
      const result = await flushEvents()
      if (result?.ok === true) return result
      const errors = Array.isArray(result?.errors) && result.errors.length > 0
        ? result.errors
        : [new Error("Harvester event journal flush failed")]
      const failure = toResult({ errors })
      reportFailure({ event: { name: "journal.flush" }, error: failure.errors[0] })
      return failure
    } catch (error) {
      reportFailure({ event: { name: "journal.flush" }, error })
      return toResult({ error })
    }
  }

  return Object.freeze({ publish, flush })
}
