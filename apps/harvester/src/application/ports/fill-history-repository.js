export function assertFillHistoryRepository({ repository } = {}) {
  if (!repository || typeof repository.upsert !== "function") {
    throw new TypeError("FillHistoryRepository must implement upsert(input)")
  }
  return repository
}
