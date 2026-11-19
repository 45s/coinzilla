import { subtractDecimal, maxDecimal, ensure, toResult } from "@coinzilla/utils"
import { getPortfolioBalanceContext } from "./strategy-account-balance-context.js"

function createStrategyOrderCommitmentInput({ balances, metadata, pairConfig, activeBaseQuantity, outstandingRecoveryAmount, actions } = {}) {
  const { accountSnapshot, position } = balances
  return {
    actions,
    quoteFreeBalance: balances.quoteBalance.amount,
    baseFreeBalance: balances.baseBalance.amount,
    quoteCashFlow: balances.quoteCashFlow,
    activeBaseQuantity: activeBaseQuantity ?? position?.baseQuantity.amount ?? "0",
    portfolioBaseBalance: balances.portfolioBaseBalance,
    portfolioBaseBalanceBaseline: accountSnapshot.getPortfolioBaseQuantityBaseline({
      assetId: metadata.market.baseAsset.id,
    }),
    additionalTrackedBaseBalance: balances.additionalTrackedBaseBalance,
    additionalTrackedBaseBalanceBaseline: balances.additionalTrackedBaseBalanceBaseline,
    outstandingRecoveryAmount: outstandingRecoveryAmount ?? maxDecimal({
      left: "0",
      right: subtractDecimal({
        left: position?.spent.amount ?? "0",
        right: "0",
      }),
    }),
    committedQuote: balances.committedQuote,
    committedQuoteBalance: balances.committedQuoteBalance,
    committedQuoteBalanceBaseline: accountSnapshot.getCommittedQuoteBalanceBaseline({
      assetId: metadata.market.quoteAsset.id,
    }),
    committedBase: balances.committedBase,
    committedBaseBalance: balances.committedBaseBalance,
    committedBaseBalanceBaseline: accountSnapshot.getCommittedBaseBalanceBaseline({
      assetId: metadata.market.baseAsset.id,
    }),
    investmentLimit: String(pairConfig.investment),
  }
}

export function allocateEvaluationActions({ dependencies, context, balances } = {}) {
  const { allocateOrderCommitments, pairs } = dependencies
  const {
    symbol,
    effectiveActions,
    recoveryLedgerBefore,
    metadata,
  } = context
  const pairConfig = context.pairConfig ?? pairs[symbol]
  const {
    position,
    accountSnapshot,
    quoteCashFlow,
    portfolioBaseBalance,
    additionalTrackedBaseBalance,
    additionalTrackedBaseBalanceBaseline,
    committedQuote,
    committedQuoteBalance,
    committedBase,
    committedBaseBalance,
    quoteBalance,
    baseBalance,
  } = balances
  const allocation = allocateOrderCommitments({
    actions: effectiveActions,
    quoteFreeBalance: quoteBalance.amount,
    baseFreeBalance: baseBalance.amount,
    quoteCashFlow,
    activeBaseQuantity: context.activeBaseQuantity ?? position?.baseQuantity.amount ?? "0",
    portfolioBaseBalance,
    portfolioBaseBalanceBaseline: accountSnapshot.getPortfolioBaseQuantityBaseline({ assetId: metadata.market.baseAsset.id }),
    additionalTrackedBaseBalance,
    additionalTrackedBaseBalanceBaseline,
    outstandingRecoveryAmount: context.outstandingRecoveryAmount ?? maxDecimal({
      left: "0",
      right: subtractDecimal({
        left: position?.spent.amount ?? "0",
        right: recoveryLedgerBefore?.netSellProceeds ?? "0",
      }),
    }),
    committedQuote,
    committedQuoteBalance,
    committedQuoteBalanceBaseline: accountSnapshot.getCommittedQuoteBalanceBaseline({ assetId: metadata.market.quoteAsset.id }),
    committedBase,
    committedBaseBalance,
    committedBaseBalanceBaseline: accountSnapshot.getCommittedBaseBalanceBaseline({ assetId: metadata.market.baseAsset.id }),
    investmentLimit: String(pairConfig.investment),
  })
  if (!allocation.ok) {
    throw allocation.errors[0] ?? new Error("Unable to allocate strategy order commitments")
  }
  return allocation.data
}

export function logOrderAllocation({ dependencies, context, balances, allocation } = {}) {
  const { logger } = dependencies
  const { evaluationId, symbol, metadata } = context
  const {
    executableActions,
    deferredActions,
    remainingQuoteBalance,
    remainingBaseBalance,
    remainingActiveBase,
    remainingInvestment,
  } = allocation
  const {
    portfolioBaseBalance,
    additionalTrackedBaseBalance,
    additionalTrackedBaseBalanceBaseline,
    committedQuote,
    committedQuoteBalance,
    committedBase,
    committedBaseBalance,
    quoteCashFlow,
    portfolioQuoteCashFlow,
    additionalQuoteCashFlow,
    quoteCashFlowBaseline,
    accountSnapshot,
  } = balances
  logger?.debug?.({
    message: "Harvester strategy order commitments allocated",
    evaluationId,
    symbol,
    executableActions,
    deferredActions,
    remainingQuoteBalance,
    remainingBaseBalance,
    remainingActiveBase,
    remainingInvestment,
    portfolioBaseBalance,
    portfolioBaseBalanceBaseline: accountSnapshot.getPortfolioBaseQuantityBaseline({ assetId: metadata.market.baseAsset.id }),
    additionalTrackedBaseBalance,
    additionalTrackedBaseBalanceBaseline,
    committedQuote,
    committedQuoteBalance,
    committedQuoteBalanceBaseline: accountSnapshot.getCommittedQuoteBalanceBaseline({ assetId: metadata.market.quoteAsset.id }),
    committedBase,
    committedBaseBalance,
    committedBaseBalanceBaseline: accountSnapshot.getCommittedBaseBalanceBaseline({ assetId: metadata.market.baseAsset.id }),
    quoteCashFlow,
    portfolioQuoteCashFlow,
    additionalQuoteCashFlow,
    quoteCashFlowBaseline,
  })
}

/**
 * Allocate one strategy's candidate actions against shared account balances and
 * account-wide reservations while keeping pair commitments strategy-owned.
 *
 * @param {object} input Strategy, Portfolio, market, active orders and actions.
 * @returns {object} Allocation result with the exact balance context used.
 */
function validateStrategyOrderCommitmentInput({
  dependencies,
  strategyId,
  symbol,
  metadata,
  portfolio,
  activeOrders,
  pairConfig,
  actions,
} = {}) {
  ensure.object({
    value: dependencies,
    name: "dependencies",
  })
  ensure.nonEmptyString({
    value: strategyId,
    name: "strategyId",
  })
  ensure.nonEmptyString({
    value: symbol,
    name: "symbol",
  })
  ensure.object({
    value: metadata,
    name: "metadata",
  })
  ensure.object({
    value: portfolio,
    name: "portfolio",
  })
  ensure.array({
    value: activeOrders,
    name: "activeOrders",
  })
  ensure.object({
    value: pairConfig,
    name: "pairConfig",
  })
  ensure.array({
    value: actions,
    name: "actions",
  })
}

function prepareStrategyOrderCommitmentContext({
  dependencies,
  strategyId,
  symbol,
  metadata,
  portfolio,
  activeOrders,
  pairConfig,
  positionId,
  activeBaseQuantity,
  outstandingRecoveryAmount,
  actions,
} = {}) {
  validateStrategyOrderCommitmentInput({
    dependencies,
    strategyId,
    symbol,
    metadata,
    portfolio,
    activeOrders,
    pairConfig,
    actions,
  })
  const strategyDependencies = {
    ...dependencies,
    strategyId,
  }
  const context = {
    symbol,
    metadata,
    portfolioBefore: portfolio,
    activeOrdersBefore: activeOrders,
    pairConfig,
    positionId,
    activeBaseQuantity,
    outstandingRecoveryAmount,
  }
  const balances = getPortfolioBalanceContext({
    dependencies: strategyDependencies,
    context,
  })
  return {
    strategyDependencies,
    context,
    balances,
  }
}

/**
 * Allocate one strategy's candidate actions against shared account balances and
 * account-wide reservations while keeping pair commitments strategy-owned.
 *
 * @param {object} input Strategy, Portfolio, market, active orders and actions.
 * @returns {object} Allocation result with the exact balance context used.
 */
export function allocateStrategyOrderCommitments({
  dependencies,
  strategyId,
  symbol,
  metadata,
  portfolio,
  activeOrders,
  pairConfig,
  positionId,
  activeBaseQuantity,
  outstandingRecoveryAmount,
  actions,
} = {}) {
  try {
    const prepared = prepareStrategyOrderCommitmentContext({
      dependencies,
      strategyId,
      symbol,
      metadata,
      portfolio,
      activeOrders,
      pairConfig,
      positionId,
      activeBaseQuantity,
      outstandingRecoveryAmount,
      actions,
    })
    const allocation = dependencies.allocateOrderCommitments(
      createStrategyOrderCommitmentInput({
        balances: prepared.balances,
        metadata,
        pairConfig,
        activeBaseQuantity,
        outstandingRecoveryAmount,
        actions,
      }),
    )
    if (!allocation?.ok) {
      return allocation
    }
    return toResult({
      data: Object.freeze({
        allocation: allocation.data,
        balances: prepared.balances,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
