import { getUserDataEventIdentity } from "./helpers/user-data-event-identity.js"

const DEFAULT_MAX_ENTRIES = 2048

/**
 * Create a bounded in-memory user-data event deduplicator.
 * Stateful lifecycle belongs outside the pure helpers directory.
 *
 * @param {{maxEntries?: number}} [options] - Maximum identities retained.
 * @returns {{isDuplicate: (message: unknown) => boolean, clear: () => void, readonly size: number}}
 * @throws {RangeError} If maxEntries is not a positive integer.
 */
export function createUserDataEventDeduplicator({ maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError("maxEntries must be a positive integer")
  }

  const identities = new Set()

  return {
    isDuplicate(message) {
      const identity = getUserDataEventIdentity(message)
      if (identity === null) {
        return false
      }
      if (identities.has(identity)) {
        return true
      }

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
