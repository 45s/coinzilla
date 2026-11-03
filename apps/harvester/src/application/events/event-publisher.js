import { defaultLogger, toResult } from "@coinzilla/utils"

/**
 * Create the application-facing, best-effort EventBus publisher.
 *
 * Publication is synchronous admission only. Subscriber work is scheduled by
 * EventBus and is never awaited by this boundary.
 *
 * @param {{ eventBus: { publish: (event: object) => object }, logger?: { error?: (entry: object) => void } }} input
 * @returns {{ publish: (event: object) => object }}
 */
export function makeEventPublisher({ eventBus, logger = defaultLogger } = {}) {
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

  return Object.freeze({ publish })
}
