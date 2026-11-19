import { addDecimal, assertDecimalString, compareDecimal, subtractDecimal, multiplyDecimal, maxDecimal, ensure } from "@coinzilla/utils"
import { StrategyId } from "../domain/strategies/strategy-ids.js"

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
  ensure.array({
    value: records,
    name: field,
    errMsg: `${field} provider must return an array`,
  })
  let total = "0"
  for (const item of records) {
    ensure.object({
      value: item,
      name: `${field}[]`,
      errMsg: `${field} requires a canonical asset ID`,
    })
    ensure.nonEmptyString({
      value: item.assetId,
      name: `${field}[].assetId`,
      errMsg: `${field} requires a canonical asset ID`,
    })
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

