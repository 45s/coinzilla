import { defaultLogger, toResult } from "@coinzilla/utils"

function createFailureReporter({ logger } = {}) {
  return ({ event, error }) => {
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
}

function createPublish({ eventBus, logger, reportFailure } = {}) {
  return (event = {}) => {
    try {
      const result = eventBus.publish(event)
      if (result?.ok === true) {
        try {
          logger?.trace?.({
            message: "Harvester event published",
            eventName: event?.name,
            source: event?.source,
          })
        } catch {
          // Diagnostic logging must not change event publication semantics.
        }
        return result
      }

      const errors = Array.isArray(result?.errors) && result.errors.length > 0
        ? result.errors
        : [new Error("EventBus publication failed without error details")]
      const failure = toResult({ errors })
      reportFailure({ event,
        error: failure.errors[0] })
      return failure
    } catch (error) {
      const failure = toResult({ error })
      reportFailure({ event,
        error })
      return failure
    }
  }
}

function createGlobalFlush({ flushEvents, logger, reportFailure } = {}) {
  return async () => {
    if (typeof flushEvents !== "function") {
      return toResult({ error: new TypeError("Harvester event publisher has no durable flush capability") })
    }
    try {
      const result = await flushEvents()
      if (result?.ok === true) {
        try {
          logger?.trace?.({ message: "Harvester event publisher flush completed" })
        } catch {
          // Diagnostic logging must not change durable flush semantics.
        }
        return result
      }
      const errors = Array.isArray(result?.errors) && result.errors.length > 0
        ? result.errors
        : [new Error("Harvester event journal flush failed")]
      const failure = toResult({ errors })
      reportFailure({ event: { name: "journal.flush" },
        error: failure.errors[0] })
      return result?.recoveryFailure
        ? { ...failure,
          recoveryFailure: result.recoveryFailure }
        : failure
    } catch (error) {
      reportFailure({ event: { name: "journal.flush" },
        error })
      return toResult({ error })
    }
  }
}

function createWriteOnlyFlush({ flushJournalWrites, logger, reportFailure } = {}) {
  return async () => {
    if (typeof flushJournalWrites !== "function") {
      return toResult({ error: new TypeError("Harvester event publisher has no write-only durable flush capability") })
    }
    try {
      const result = await flushJournalWrites()
      if (result?.ok === true && result?.durable === true) {
        try {
          logger?.trace?.({ message: "Harvester event publisher write-only flush completed" })
        } catch {
          // Diagnostic logging must not change durable flush semantics.
        }
        return result
      }
      const errors = Array.isArray(result?.errors) && result.errors.length > 0
        ? result.errors
        : [new Error("Harvester write-only Journal flush did not confirm durable persistence")]
      const failure = toResult({ errors })
      reportFailure({ event: { name: "journal.flush_writes" },
        error: failure.errors[0] })
      if (result?.recoveryFailure) {
        return {
          ...failure,
          recoveryFailure: result.recoveryFailure,
        }
      }
      return failure
    } catch (error) {
      reportFailure({ event: { name: "journal.flush_writes" },
        error })
      return toResult({ error })
    }
  }
}

/** Compose synchronous EventBus publication with separate global and write-only durability barriers. */
export function makeEventPublisher({ eventBus, flush: flushEvents, flushWrites: flushJournalWrites, logger = defaultLogger } = {}) {
  const reportFailure = createFailureReporter({ logger })
  return Object.freeze({
    publish: createPublish({
      eventBus,
      logger,
      reportFailure,
    }),
    flush: createGlobalFlush({
      flushEvents,
      logger,
      reportFailure,
    }),
    flushWrites: createWriteOnlyFlush({
      flushJournalWrites,
      logger,
      reportFailure,
    }),
    reportFailure,
  })
}
