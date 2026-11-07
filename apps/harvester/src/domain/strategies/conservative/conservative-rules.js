import { compareDecimal } from "@coinzilla/utils"

const ACTIVE_ORDER_STATUSES = new Set([
  "PENDING",
  "OPEN",
  "PARTIALLY_FILLED",
  "UNKNOWN",
])

/**
 * Whether an order state must suppress another intent on the same side.
 */
export function isActiveOrderStatus({ status } = {}) {
  return ACTIVE_ORDER_STATUSES.has(status)
}

/**
 * Whether a matching market/side already has an order that blocks a duplicate intent.
 */
export function hasActiveOrder({ activeOrders = [], symbol, side } = {}) {
  return activeOrders.some((order) =>
    order?.market?.symbol === symbol &&
    order.side === side &&
    isActiveOrderStatus({ status: order.status }))
}

/**
 * Whether the strategy currently owns a positive active position.
 */
export function hasActivePosition({ activeQuantity } = {}) {
  return compareDecimal({ left: activeQuantity, right: "0" }) > 0
}

/**
 * Whether strategy-owned inventory exists above the exact retained keep quantity.
 */
export function hasSellableInventory({ activeQuantity, keepQuantity } = {}) {
  return compareDecimal({ left: activeQuantity, right: keepQuantity }) > 0
}

/**
 * Whether cumulative confirmed net SELL proceeds have not recovered full BUY cost.
 */
export function hasOutstandingRecovery({ positionSpent, netSellProceeds } = {}) {
  return compareDecimal({ left: positionSpent, right: netSellProceeds }) > 0
}
