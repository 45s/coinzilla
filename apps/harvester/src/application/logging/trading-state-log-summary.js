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
    quantity: position.quantity.amount,
    spent: position.spent.amount,
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
    legacyBuyCostMirror: recoveryLedger.buyCost,
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


/**
 * Build a readable Portfolio Stats snapshot using only exact Portfolio values.
 * Exchange balances and RecoveryLedger accounting are intentionally excluded.
 *
 * @param {object} input
 * @param {object} input.position
 * @returns {object|null}
 */
export function createPortfolioStatsLogSummary({ position } = {}) {
  if (!position) return null

  const baseAsset = position.market.baseAsset.code
  const quoteAsset = position.market.quoteAsset.code

  return {
    message: "Portfolio Stats",
    symbol: position.market.symbol,
    inventory: {
      activeBaseQuantity: position.baseQuantity.amount + " " + baseAsset,
      freeBaseQuantity: position.freeBaseQuantity.amount + " " + baseAsset,
      totalBaseQuantity: position.totalBaseQuantity.amount + " " + baseAsset,
    },
    accounting: {
      spent: position.spent.amount + " " + quoteAsset,
      quoteNetCashFlow: position.quoteNetCashFlow.amount + " " + quoteAsset,
    },
  }
}
