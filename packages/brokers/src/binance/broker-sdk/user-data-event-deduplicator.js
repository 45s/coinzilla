const DEFAULT_MAX_ENTRIES = 2048

function unwrapUserDataEvent(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null
  const event = message.event && typeof message.event === "object"
    ? message.event
    : message
  if (!event || typeof event !== "object" || Array.isArray(event)) return null
  return { subscriptionId: message.subscriptionId ?? null, event }
}

function executionReportIdentity(event) {
  if (event.e !== "executionReport" ||
      typeof event.s !== "string" ||
      !Number.isSafeInteger(event.i) ||
      !Number.isSafeInteger(event.I)) {
    return null
  }

  return `executionReport:${event.s}:${event.i}:${event.I}`
}

export function getUserDataEventIdentity(message) {
  const unwrapped = unwrapUserDataEvent(message)
  if (!unwrapped) return null

  const executionIdentity = executionReportIdentity(unwrapped.event)
  if (executionIdentity) {
    return `${unwrapped.subscriptionId ?? "unknown"}:${executionIdentity}`
  }

  try {
    return `${unwrapped.subscriptionId ?? "unknown"}:payload:${JSON.stringify(unwrapped.event)}`
  } catch {
    return null
  }
}

export function createUserDataEventDeduplicator({ maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError("maxEntries must be a positive integer")
  }

  const identities = new Set()

  return {
    isDuplicate(message) {
      const identity = getUserDataEventIdentity(message)
      if (identity === null) return false
      if (identities.has(identity)) return true

      identities.add(identity)
      if (identities.size > maxEntries) {
        identities.delete(identities.values().next().value)
      }
      return false
    },

    clear() {
      identities.clear()
    },

    get size() {
      return identities.size
    },
  }
}
