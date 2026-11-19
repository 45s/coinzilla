import { addDecimal, assertDecimalString, compareDecimal, subtractDecimal, multiplyDecimal, maxDecimal, ensure, toResult } from "@coinzilla/utils"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import { mapStrategyDecisionData } from "../application/events/lifecycle-event-dtos.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"

function sumDecimalValues({ items, getValue } = {}) {
  let total = "0"
  for (const item of items) {
    total = addDecimal({
      left: total,
      right: getValue(item),
    })
  }
  return total
}

function sumAdditionalTrackedAmount({
  records,
  assetId,
  field,
  allowNegative,
} = {}) {
  if (!Array.isArray(records)) {
    throw new TypeError(`${field} provider must return an array`)
  }
  let total = "0"
  for (const item of records) {
    if (!item || typeof item.assetId !== "string" || !item.assetId.trim()) {
      throw new TypeError(`${field} requires a canonical asset ID`)
    }
    assertDecimalString({
      value: item.amount,
      field: `${field}.amount`,
    })
    if (!allowNegative && compareDecimal({
      left: item.amount,
      right: "0",
    }) < 0) {
      throw new RangeError(`${field}.amount must be non-negative`)
    }
    if (item.assetId === assetId) {
      total = addDecimal({
        left: total,
        right: item.amount,
      })
    }
  }
  return total
}

function getAdditionalTrackedBaseBalance({
  dependencies,
  accountSnapshot,
  portfolio,
  assetId,
} = {}) {
  const records = typeof dependencies.getAdditionalTrackedBaseQuantity === "function"
    ? dependencies.getAdditionalTrackedBaseQuantity({
      balances: accountSnapshot.balances ?? [],
      portfolio,
    })
    : []
  return sumAdditionalTrackedAmount({
    records,
    assetId,
    field: "additionalTrackedBaseQuantity",
    allowNegative: false,
  })
}

function getAdditionalTrackedQuoteCashFlow({
  dependencies,
  accountSnapshot,
  portfolio,
  assetId,
} = {}) {
  const records = typeof dependencies.getAdditionalTrackedQuoteCashFlow === "function"
    ? dependencies.getAdditionalTrackedQuoteCashFlow({
      balances: accountSnapshot.balances ?? [],
      portfolio,
    })
    : []
  return sumAdditionalTrackedAmount({
    records,
    assetId,
    field: "additionalTrackedQuoteCashFlow",
    allowNegative: true,
  })
}

function getActiveOrderCommitments({
  dependencies,
  activeOrdersBefore,
  excludedActiveOrderClientId,
  metadata,
} = {}) {
  const allActiveOrders = dependencies.state.registry.getActiveOrders()
    .filter((order) => order.clientOrderId !== excludedActiveOrderClientId)
  const committedQuote = sumDecimalValues({
    items: activeOrdersBefore.filter((order) => order.side === "BUY"),
    getValue: (order) => multiplyDecimal({
      left: order.remainingQuantity.amount,
      right: order.limitPrice.amount,
    }),
  })
  const committedQuoteBalance = sumDecimalValues({
    items: allActiveOrders.filter((order) =>
      order.side === "BUY" &&
      order.market.quoteAsset.id === metadata.market.quoteAsset.id),
    getValue: (order) => multiplyDecimal({
      left: order.remainingQuantity.amount,
      right: order.limitPrice.amount,
    }),
  })
  const committedBase = sumDecimalValues({
    items: activeOrdersBefore.filter((order) => order.side === "SELL"),
    getValue: (order) => order.remainingQuantity.amount,
  })
  const committedBaseBalance = sumDecimalValues({
    items: allActiveOrders.filter((order) =>
      order.side === "SELL" &&
      order.market.baseAsset.id === metadata.market.baseAsset.id),
    getValue: (order) => order.remainingQuantity.amount,
  })
  return {
    committedQuote,
    committedQuoteBalance,
    committedBase,
    committedBaseBalance,
  }
}

function getPortfolioCashFlowContext({ dependencies, accountSnapshot, portfolio, metadata } = {}) {
  const portfolioQuoteCashFlow = sumDecimalValues({
    items: portfolio.positions.filter((item) =>
      item.market.quoteAsset.id === metadata.market.quoteAsset.id),
    getValue: (item) => item.quoteNetCashFlow.amount,
  })
  const additionalQuoteCashFlow = getAdditionalTrackedQuoteCashFlow({
    dependencies,
    accountSnapshot,
    portfolio,
    assetId: metadata.market.quoteAsset.id,
  })
  const quoteCashFlowBaseline = accountSnapshot.getQuoteCashFlowBaseline?.({
    assetId: metadata.market.quoteAsset.id,
  }) ?? "0"
  return {
    portfolioQuoteCashFlow,
    additionalQuoteCashFlow,
    quoteCashFlowBaseline,
    quoteCashFlow: subtractDecimal({
      left: addDecimal({
        left: portfolioQuoteCashFlow,
        right: additionalQuoteCashFlow,
      }),
      right: quoteCashFlowBaseline,
    }),
  }
}

function getPortfolioBaseBalanceContext({ dependencies, accountSnapshot, portfolio, metadata } = {}) {
  const portfolioBaseBalance = sumDecimalValues({
    items: portfolio.positions.filter((item) =>
      item.market.baseAsset.id === metadata.market.baseAsset.id),
    getValue: (item) => item.totalBaseQuantity.amount,
  })
  return {
    portfolioBaseBalance,
    additionalTrackedBaseBalance: getAdditionalTrackedBaseBalance({
      dependencies,
      accountSnapshot,
      portfolio,
      assetId: metadata.market.baseAsset.id,
    }),
    additionalTrackedBaseBalanceBaseline: accountSnapshot.getAdditionalTrackedBaseQuantityBaseline?.({
      assetId: metadata.market.baseAsset.id,
    }) ?? "0",
  }
}

export function getPortfolioBalanceContext({ dependencies, context } = {}) {
  const { metadata, portfolioBefore, activeOrdersBefore, excludedActiveOrderClientId } = context
  const accountSnapshot = dependencies.getAccountSnapshot()
  if (!accountSnapshot) {
    throw new Error("Current account snapshot is unavailable")
  }
  const position = portfolioBefore.getPosition({
    strategyId: dependencies.strategyId ?? StrategyId.COIN_GRABBER,
    marketId: metadata.market.id,
    ...(context.positionId === undefined ? {} : { positionId: context.positionId }),
  })
  const cashFlow = getPortfolioCashFlowContext({
    dependencies,
    accountSnapshot,
    portfolio: portfolioBefore,
    metadata,
  })
  const baseBalanceContext = getPortfolioBaseBalanceContext({
    dependencies,
    accountSnapshot,
    portfolio: portfolioBefore,
    metadata,
  })
  const commitments = getActiveOrderCommitments({
    dependencies,
    activeOrdersBefore,
    excludedActiveOrderClientId,
    metadata,
  })
  const quoteBalance = accountSnapshot.getFreeBalance({ assetId: metadata.market.quoteAsset.id })
  const baseBalance = accountSnapshot.getFreeBalance({ assetId: metadata.market.baseAsset.id })
  if (!quoteBalance || !baseBalance) {
    throw new Error("Current account snapshot is missing an enabled market asset balance")
  }
  return {
    accountSnapshot,
    position,
    ...cashFlow,
    ...baseBalanceContext,
    ...commitments,
    quoteBalance,
    baseBalance,
  }
}

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
    ensure.object({ value: dependencies, name: "dependencies" })
    ensure.nonEmptyString({ value: strategyId, name: "strategyId" })
    ensure.nonEmptyString({ value: symbol, name: "symbol" })
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
    const allocation = dependencies.allocateOrderCommitments(
      createStrategyOrderCommitmentInput({
        balances,
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
        balances,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}

