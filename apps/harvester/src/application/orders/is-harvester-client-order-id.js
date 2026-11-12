/**
 * Identify client IDs reserved by Harvester's order-submission use case.
 *
 * Harvester-generated IDs use the reserved "h-" prefix. An unmatched order
 * with that prefix may belong to a prior Harvester process and must not be
 * silently treated as a manual/external order.
 *
 * @param {unknown} clientOrderId - Canonical exchange client order ID.
 * @returns {boolean} Whether the ID belongs to Harvester's reserved namespace.
 */
export function isHarvesterClientOrderId(clientOrderId) {
  return typeof clientOrderId === "string" && clientOrderId.startsWith("h-")
}
