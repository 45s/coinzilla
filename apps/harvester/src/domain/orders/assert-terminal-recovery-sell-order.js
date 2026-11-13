import { CanonicalOrder } from "@coinzilla/entities"
import { compareDecimal } from "@coinzilla/utils"

/**
 * Require canonical evidence that a recovery SELL reached its exact terminal fill.
 *
 * This pure guard is shared by the in-memory recovery workflow and durable
 * completion recorders so an accounting reset cannot be authorized by a
 * profitability calculation alone.
 *
 * @param {object} input
 * @param {CanonicalOrder} input.sellOrder Canonical terminal SELL order.
 * @param {string} [input.marketId] Expected market identity.
 * @returns {CanonicalOrder} The validated terminal SELL order.
 * @throws {TypeError} When the order is missing, non-canonical, not a filled SELL, or belongs to another market.
 */
export function assertTerminalRecoverySellOrder({ sellOrder, marketId } = {}) {
  if (!(sellOrder instanceof CanonicalOrder) ||
      sellOrder.side !== "SELL" ||
      sellOrder.status !== "FILLED" ||
      typeof sellOrder.brokerOrderId !== "string" ||
      !sellOrder.brokerOrderId.trim() ||
      compareDecimal({
        left: sellOrder.executedQuantity.amount,
        right: sellOrder.originalQuantity.amount,
      }) !== 0) {
    throw new TypeError("Recovery-cycle transition requires the canonical fully filled terminal SELL order")
  }

  if (marketId !== undefined && sellOrder.market.id !== marketId) {
    throw new TypeError("Recovery-cycle terminal SELL market must match the active Position and RecoveryLedger market")
  }

  return sellOrder
}
