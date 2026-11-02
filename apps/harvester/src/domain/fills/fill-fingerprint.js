import { Fill } from "@coinzilla/entities"

/**
 * Produce a deterministic fingerprint for a canonical execution.
 *
 * The canonical Fill ID is market + trade ID. If a broker later reuses that
 * identity with different execution facts, callers can detect the accounting
 * conflict instead of silently treating it as an identical duplicate.
 *
 * @param {object} input
 * @param {Fill} input.fill Canonical execution.
 * @returns {string} Stable JSON fingerprint of execution facts.
 */
export function createFillFingerprint({ fill } = {}) {
  if (!(fill instanceof Fill)) {
    throw new TypeError("createFillFingerprint requires a canonical Fill")
  }

  const commissions = fill.commissions
    .map((commission) => ({
      assetId: commission.amount.asset.id,
      amount: commission.amount.amount,
    }))
    .sort((left, right) => {
      const leftKey = left.assetId + ":" + left.amount
      const rightKey = right.assetId + ":" + right.amount
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    })

  return JSON.stringify({
    id: fill.id,
    brokerOrderId: fill.brokerOrderId,
    clientOrderId: fill.clientOrderId ?? null,
    marketId: fill.market.id,
    side: fill.side,
    price: fill.price.amount,
    quantity: fill.quantity.amount,
    quoteQuantity: fill.quoteQuantity.amount,
    liquidityRole: fill.liquidityRole,
    executedAt: fill.executedAt ?? null,
    commissions,
    commissionStatus: fill.commissionStatus,
  })
}
