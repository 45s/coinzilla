import { toResult } from "@coinzilla/utils"
import { HARVESTER_EVENT_SOURCE } from "./event-names.js"

function reportPublicationFailure({ eventPublisher, eventName, error } = {}) {
  try {
    eventPublisher?.reportFailure?.({
      event: {
        name: eventName,
        source: HARVESTER_EVENT_SOURCE,
      },
      error,
    })
  } catch {
    // Best-effort publication diagnostics must not block the caller.
  }
}

function reportMappingFailure({ eventPublisher, eventName, dataResult } = {}) {
  if (typeof eventPublisher?.reportFailure !== "function") {
    return
  }
  const errors = Array.isArray(dataResult?.errors) && dataResult.errors.length > 0
    ? dataResult.errors
    : [new TypeError("A successful lifecycle DTO mapping result is required")]
  for (const error of errors) {
    reportPublicationFailure({ eventPublisher, eventName, error })
  }
}

function reportAsyncPublicationResult({ eventPublisher, eventName, result } = {}) {
  if (result?.ok !== false) {
    return
  }
  const errors = Array.isArray(result.errors) && result.errors.length > 0
    ? result.errors
    : [new Error("Asynchronous lifecycle event publication failed")]
  for (const error of errors) {
    reportPublicationFailure({ eventPublisher, eventName, error })
  }
}

function observeAsyncPublication({ publication, eventPublisher, eventName } = {}) {
  Promise.resolve(publication)
    .then((result) => reportAsyncPublicationResult({
      eventPublisher,
      eventName,
      result,
    }))
    .catch((error) => reportPublicationFailure({
      eventPublisher,
      eventName,
      error,
    }))
  return {
    ok: true,
    pending: true,
  }
}

function publishMappedLifecycleEvent({ eventPublisher, eventName, data } = {}) {
  try {
    const publication = eventPublisher.publish({
      name: eventName,
      source: HARVESTER_EVENT_SOURCE,
      data,
    })
    return publication && typeof publication.then === "function"
      ? observeAsyncPublication({ publication, eventPublisher, eventName })
      : publication
  } catch (error) {
    return toResult({ error })
  }
}

/** Publish a mapped lifecycle DTO synchronously and best-effort. */
export function publishLifecycleEvent({
  eventPublisher,
  eventName,
  dataResult,
} = {}) {
  if (!dataResult?.ok) {
    reportMappingFailure({ eventPublisher, eventName, dataResult })
    return dataResult ?? toResult({
      error: new TypeError("A successful lifecycle DTO mapping result is required"),
    })
  }
  if (typeof eventPublisher?.publish !== "function") {
    return toResult({ skipped: true })
  }
  return publishMappedLifecycleEvent({
    eventPublisher,
    eventName,
    data: dataResult.data,
  })
}
