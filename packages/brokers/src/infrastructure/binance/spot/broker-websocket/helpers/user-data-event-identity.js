function unwrapUserDataEvent(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null
  }
  const event = message.event && typeof message.event === "object"
    ? message.event
    : message
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null
  }
  return {
    subscriptionId: message.subscriptionId ?? null,
    event,
  }
}

function executionReportIdentity(event) {
  if (
    event.e !== "executionReport" ||
    typeof event.s !== "string" ||
    !Number.isSafeInteger(event.i) ||
    !Number.isSafeInteger(event.I)
  ) {
    return null
  }

  return `executionReport:${event.s}:${event.i}:${event.I}`
}

/**
 * Return a stable identity for a user-data event, or null when it cannot be identified.
 *
 * @param {unknown} message - Binance user-data message or wrapped event.
 * @returns {string|null}
 */
export function getUserDataEventIdentity(message) {
  const unwrapped = unwrapUserDataEvent(message)
  if (!unwrapped) {
    return null
  }

  const executionIdentity = executionReportIdentity(unwrapped.event)
  if (executionIdentity) {
    return executionIdentity
  }

  try {
    return `payload:${JSON.stringify(unwrapped.event)}`
  } catch {
    return null
  }
}
