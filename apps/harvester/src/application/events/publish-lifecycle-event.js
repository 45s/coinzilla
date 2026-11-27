import { toResult } from "@coinzilla/utils"
import { HARVESTER_EVENT_SOURCE } from "./event-names.js"

/**
 * Publish a mapped lifecycle DTO synchronously and best-effort.
 * The EventBus publisher owns validation and delivery-failure diagnostics.
 */
function reportPublicationFailure({ eventPublisher, eventName, error } = {}) {
  try {
    eventPublisher?.reportFailure?.({
      event: { name: eventName,
        source: HARVESTER_EVENT_SOURCE },
      error,
    })
  } catch {
    // Best-effort publication diagnostics must not block the caller.
  }
}

export function publishLifecycleEvent({
  eventPublisher,
  eventName,
  dataResult,
} = {}) {
  if (!dataResult?.ok) {
    if (typeof eventPublisher?.reportFailure === "function") {
      const errors = Array.isArray(dataResult?.errors) && dataResult.errors.length > 0
        ? dataResult.errors
        : [new TypeError("A successful lifecycle DTO mapping result is required")]
      for (const error of errors) {
        try {
          eventPublisher.reportFailure({
            event: { name: eventName,
              source: HARVESTER_EVENT_SOURCE },
            error,
          })
        } catch {
          // Optional diagnostics must not change best-effort publication semantics.
        }
      }
    }
    return dataResult ?? toResult({
      error: new TypeError("A successful lifecycle DTO mapping result is required"),
    })
  }
  if (typeof eventPublisher?.publish !== "function") {
    return toResult({ skipped: true })
  }

  try {
    const publication = eventPublisher.publish({
      name: eventName,
      source: HARVESTER_EVENT_SOURCE,
      data: dataResult.data,
    })
    if (publication && typeof publication.then === "function") {
      Promise.resolve(publication).then((result) => {
        if (result?.ok === false) {
          const errors = Array.isArray(result.errors) && result.errors.length > 0
            ? result.errors
            : [new Error("Asynchronous lifecycle event publication failed")]
          for (const error of errors) {
            reportPublicationFailure({ eventPublisher, eventName, error })
          }
        }
      }).catch((error) => reportPublicationFailure({ eventPublisher, eventName, error }))
      return { ok: true,
        pending: true }
    }
    return publication
  } catch (error) {
    return toResult({ error })
  }
}
