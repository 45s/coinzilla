/**
 * Build a bounded Position snapshot for DEBUG logs without exposing Portfolio
 * execution identity records.
 *
 * @param {object} input
 * @param {object} [input.position]
 * @returns {object|null}
 */
export function createPositionLogSummary({ position } = {}) {
  if (!position) return null

  return {
    marketId: position.market.id,
    symbol: position.market.symbol,
    activeBaseQuantity: position.baseQuantity.amount,
    freeBaseQuantity: position.freeBaseQuantity.amount,
    totalBaseQuantity: position.totalBaseQuantity.amount,
    quoteNetCashFlow: position.quoteNetCashFlow.amount,
  }
}

/**
 * Build a bounded RecoveryLedger snapshot. Execution IDs and deterministic
 * fill fingerprints are intentionally represented only by their count.
 *
 * @param {object} input
 * @param {object} [input.recoveryLedger]
 * @returns {object|null}
 */
export function createRecoveryLedgerLogSummary({ recoveryLedger } = {}) {
  if (!recoveryLedger) return null

  return {
    marketId: recoveryLedger.market.id,
    symbol: recoveryLedger.market.symbol,
    buyCost: recoveryLedger.buyCost,
    netSellProceeds: recoveryLedger.netSellProceeds,
    outstandingRecoveryAmount: recoveryLedger.outstandingRecoveryAmount,
    realizedNetProfit: recoveryLedger.realizedNetProfit,
    appliedFillCount: recoveryLedger.appliedFillIds.length,
  }
}

/**
 * Summarize only the market being evaluated, not every Portfolio position.
 *
 * @param {object} input
 * @param {object} input.portfolio
 * @param {string} input.marketId
 * @returns {{ position: object|null, appliedFillCount: number }}
 */
export function createPortfolioLogSummary({ portfolio, marketId } = {}) {
  return {
    position: createPositionLogSummary({
      position: typeof marketId === "string" ? portfolio.getPosition({ marketId }) : undefined,
    }),
    appliedFillCount: portfolio.appliedFillIds.length,
  }
}
