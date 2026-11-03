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
  if (!dataResult?.ok) return dataResult ?? toResult({
    error: new TypeError("A successful lifecycle DTO mapping result is required"),
  })
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
