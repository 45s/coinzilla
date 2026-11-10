import { toResult } from "@coinzilla/utils"

const CANCELLABLE_STATUSES = new Set(["OPEN", "PARTIALLY_FILLED"])

/**
 * Validate that an order has a broker acknowledgement and is still cancellable.
 * This policy is exchange-independent; adapters validate exchange-specific IDs.
 */
export function validateCancellationEligibility({ order } = {}) {
  if (order === null || typeof order !== "object" || Array.isArray(order)) {
    return toResult({ error: new TypeError("Cancellation requires an order object") })
  }

  if (!CANCELLABLE_STATUSES.has(order.status)) {
    return toResult({
      error: new Error("Order in " + String(order.status) + " state is not cancellable"),
    })
  }

  if (typeof order.brokerOrderId !== "string" || !order.brokerOrderId.trim()) {
    return toResult({
      error: new Error("Cancellation requires a broker-acknowledged order with brokerOrderId"),
    })
  }

  return toResult({ data: { order } })
}
