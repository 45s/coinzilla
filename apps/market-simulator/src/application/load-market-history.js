/** Application use case. The repository is a port supplied by the composition root. */
export async function loadMarketHistory({ repository }) {
  if (!repository || typeof repository.load !== "function") {
    throw new TypeError("A market history repository with load() is required")
  }
  return repository.load()
}
