/**
 * Validate the application-owned Operational State Store port defined by ADR-0001.
 *
 * The infrastructure adapter must append to the single Harvester Operational State Store record
 * stream and return durable: true only after the record and committed head are
 * synced. Exact duplicate factId/payload pairs must be idempotent; reuse of a
 * factId with different payload is an integrity error. Journal is not an
 * implementation of this port.
 *
 * @param {object} options
 * @param {object} options.operationalStateStore - Application-owned Operational State Store adapter.
 * @returns {object} The validated Operational State Store adapter.
 */
export function assertOperationalStatePort({ operationalStateStore } = {}) {
  if (typeof operationalStateStore?.append !== "function") {
    throw new TypeError("Harvester operator control requires the ADR-0001 Operational State Store append capability")
  }
  return operationalStateStore
}
