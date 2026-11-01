import { toResult } from "@coinzilla/utils"

/**
 * Create the application workflow for submitting one domain-approved order.
 * Trading policy and order construction stay outside this use case.
 */
export function makePlaceOrder({ broker } = {}) {
  if (broker === null || typeof broker?.placeOrder !== "function") {
    throw new TypeError("makePlaceOrder requires a broker port with placeOrder()")
  }

  return async function placeOrder({ order } = {}) {
    if (order === null || typeof order !== "object" || Array.isArray(order)) {
      return toResult({
        error: new TypeError("placeOrder requires an order object"),
      })
    }

    // Preserve the broker result exactly. A thrown transport error is allowed
    // to propagate because a state-changing request may have an unknown outcome.
    return broker.placeOrder({ order })
  }
}
