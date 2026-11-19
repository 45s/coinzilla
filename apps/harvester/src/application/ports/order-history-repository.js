/**
 * Validate the narrow repository port used by the order-history projection.
 *
 * @param {{repository: {upsert: Function}}} input
 * @returns {{upsert: Function}}
 * @throws {TypeError} When the supplied adapter does not implement upsert(record).
 */
export function assertOrderHistoryRepository({ repository } = {}) {
  if (!repository || typeof repository.upsert !== "function") {
    throw new TypeError("OrderHistoryRepository must implement upsert(record)")
  }
  return repository
}
