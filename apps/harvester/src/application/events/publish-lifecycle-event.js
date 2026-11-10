import { toResult } from "@coinzilla/utils"
import { HARVESTER_EVENT_SOURCE } from "./event-names.js"

/**
 * Publish a mapped lifecycle DTO synchronously and best-effort.
 * The EventBus publisher owns validation and delivery-failure diagnostics.
 */
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
            event: { name: eventName, source: HARVESTER_EVENT_SOURCE },
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
    return eventPublisher.publish({
      name: eventName,
      source: HARVESTER_EVENT_SOURCE,
      data: dataResult.data,
    })
  } catch (error) {
    return toResult({ error })
  }
}
