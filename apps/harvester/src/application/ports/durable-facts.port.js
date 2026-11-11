/**
 * Validate the application-owned durable-facts port defined by ADR-0001.
 *
 * The infrastructure adapter must append to the single Harvester durable-fact
 * stream and return durable: true only after the record and committed head are
 * synced. Exact duplicate factId/payload pairs must be idempotent; reuse of a
 * factId with different payload is an integrity error. Journal is not an
 * implementation of this port.
 *
 * @param {object} options
 * @param {object} options.durableFacts - Application-owned durable-facts adapter.
 * @returns {object} The validated durable-facts adapter.
 */
export function assertDurableFactsPort({ durableFacts } = {}) {
  if (typeof durableFacts?.append !== "function") {
    throw new TypeError("Harvester operator control requires the ADR-0001 durable-facts append port")
  }
  return durableFacts
}
