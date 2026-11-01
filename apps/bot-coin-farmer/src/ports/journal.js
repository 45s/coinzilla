const REQUIRED_METHODS = ["start", "close"]

export function assertJournalPort(journal) {
  if (journal === null || typeof journal !== "object") {
    throw new TypeError("journal port must be an object")
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof journal[method] !== "function") {
      throw new TypeError(`journal port must implement ${method}()`)
    }
  }

  return journal
}
