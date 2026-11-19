import { addDecimal, assertDecimalString, compareDecimal, divideDecimal, maxDecimal, multiplyDecimal, roundDecimalToIncrement, subtractDecimal } from "@coinzilla/utils"
import { Portfolio } from "../../portfolio/portfolio.js"
import { StrategyId } from "../strategy-ids.js"
import { calculateInitialBuyPrice } from "./initial-buy-price.js"
import { calculateRecoverySellPlan } from "./recovery-sell-plan.js"
import { calculateSellFeeRate } from "./sell-fee-rate.js"
import { hasActiveOrder, hasActivePosition, hasOutstandingRecovery, hasSellableInventory } from "./helpers.js"

/**
 * Evaluate the broker-independent Conservative (Free-Roll) policy.
 *
 * A price event may produce both a standing BUY and a recovery SELL. Active
 * orders are supplied by the engine so repeated market events do not duplicate
 * either side. This function creates intents only; it never performs I/O.
 */
function getNoActionReason({ actions, inventoryDisposition, buyDisposition }) {
  if (actions.length > 0) {return null}

  if (inventoryDisposition) {
    if (inventoryDisposition.status === "PRICE_FILTER_BLOCKED") {
      return "Residual SELL is deferred because the profit-preserving price is outside exchange price filters"
    }
    return "Residual inventory is currently below exchange SELL filters and is classified as dust"
  }

  if (buyDisposition) {
    return "Configured BUY is currently outside exchange filters and was deferred"
  }

  return "Required standing orders are already active or no sellable recovery inventory is available"
}

function getRequiredRuleAmount({ marketMetadata, type }) {
  const rule = marketMetadata.tradingRules.constraints.find((item) =>
    item.type === type && item.status === "SUPPORTED")
  if (!rule?.value || typeof rule.value.amount !== "string") {
    throw new Error(`Required exchange trading rule is unavailable: ${type}`)
  }
  assertDecimalString({ value: rule.value.amount,
field: type })
  if (compareDecimal({ left: rule.value.amount,
right: "0" }) <= 0) {
    throw new RangeError(`Exchange trading rule must be positive: ${type}`)
  }
  return rule.value.amount
}

function getOptionalRuleAmount({ marketMetadata, type }) {
  const rule = marketMetadata.tradingRules.constraints.find((item) =>
    item.type === type && item.status === "SUPPORTED")
  if (!rule) {return undefined}
  if (!rule.value || typeof rule.value.amount !== "string") {
    throw new Error(`Supported exchange trading rule has no amount: ${type}`)
  }
  assertDecimalString({ value: rule.value.amount,
field: type })
  return compareDecimal({ left: rule.value.amount,
right: "0" }) > 0
    ? rule.value.amount
    : undefined
}

function validateMarketPriceInput(marketPrice) {
  if (!marketPrice || typeof marketPrice.symbol !== "string") {
    throw new TypeError("Conservative strategy requires a validated marketPrice")
  }
}

function validatePairConfigInput(pairConfig) {
  if (!pairConfig || typeof pairConfig !== "object" || Array.isArray(pairConfig)) {
    throw new TypeError("Conservative strategy requires pairConfig")
  }
}

function validateSettingsInput(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new TypeError("Conservative strategy requires settings")
  }
}

function validatePortfolioInput(portfolio) {
  if (!(portfolio instanceof Portfolio)) {
    throw new TypeError("Conservative strategy requires a Portfolio")
  }
}

function validateMarketMetadataInput({
  marketMetadata,
  marketPrice,
}) {
  if (!marketMetadata?.market || marketMetadata.market.symbol !== marketPrice.symbol) {
    throw new TypeError("Conservative strategy requires matching canonical market metadata")
  }
  if (!marketMetadata?.tradingRules?.constraints || !Array.isArray(marketMetadata.tradingRules.constraints)) {
    throw new TypeError("Conservative strategy requires normalized exchange trading rules")
  }
}

function validateActiveOrdersInput(activeOrders) {
  if (!Array.isArray(activeOrders)) {
    throw new TypeError("Conservative strategy activeOrders must be an array")
  }
}

function validateStrategyInputShape(input) {
  validateMarketPriceInput(input.marketPrice)
  validatePairConfigInput(input.pairConfig)
  validateSettingsInput(input.settings)
  validatePortfolioInput(input.portfolio)
  validateMarketMetadataInput({
    marketMetadata: input.marketMetadata,
    marketPrice: input.marketPrice,
  })
  validateActiveOrdersInput(input.activeOrders)
}
function resolveStrategyExchangeFilters({ marketMetadata }) {
  return {
    priceTickSize: getRequiredRuleAmount({
      marketMetadata,
      type: "PRICE_INCREMENT",
    }),
    quantityStepSize: getRequiredRuleAmount({
      marketMetadata,
      type: "QUANTITY_INCREMENT",
    }),
    minQuantity: getRequiredRuleAmount({
      marketMetadata,
      type: "MIN_QUANTITY",
    }),
    minNotional: getRequiredRuleAmount({
      marketMetadata,
      type: "MIN_NOTIONAL",
    }),
    minPrice: getOptionalRuleAmount({
      marketMetadata,
      type: "MIN_PRICE",
    }),
    maxPrice: getOptionalRuleAmount({
      marketMetadata,
      type: "MAX_PRICE",
    }),
    maxQuantity: getOptionalRuleAmount({
      marketMetadata,
      type: "MAX_QUANTITY",
    }),
    maxNotional: getOptionalRuleAmount({
      marketMetadata,
      type: "MAX_NOTIONAL",
    }),
  }
}

function resolveStrategyActiveOrderFlags({
  activeOrders,
  symbol,
}) {
  return {
    hasActiveBuy: hasActiveOrder({
      activeOrders,
      symbol,
      side: "BUY",
    }),
    hasActiveSell: hasActiveOrder({
      activeOrders,
      symbol,
      side: "SELL",
    }),
    hasUnacknowledgedRecoverySell: activeOrders.some((order) =>
      order?.market?.symbol === symbol &&
      order.side === "SELL" &&
      (order.status === "PENDING" || order.status === "UNKNOWN")),
  }
}

function validateStrategyInput(input) {
  validateStrategyInputShape(input)
  const {
    marketPrice,
    pairConfig,
    portfolio,
    marketMetadata,
    activeOrders,
  } = input
  const exchangeFilters = resolveStrategyExchangeFilters({ marketMetadata })
  const activeOrderFlags = resolveStrategyActiveOrderFlags({
    activeOrders,
    symbol: marketPrice.symbol,
  })
  return {
    marketPrice,
    pairConfig,
    portfolio,
    marketMetadata,
    activeOrders,
    ...exchangeFilters,
    ...activeOrderFlags,
  }
}

function validateRecoveryAccounting({
  recoveryLedger,
  position,
  activeQuantity,
  positionSpent,
  ledger,
}) {
  if (recoveryLedger && position &&
      compareDecimal({
        left: ledger.buyCost,
        right: positionSpent,
      }) !== 0) {
    throw new Error("Conservative Position.spent and legacy RecoveryLedger cost mirror diverged")
  }
  if (hasActivePosition({ activeQuantity }) &&
      compareDecimal({
        left: positionSpent,
        right: "0",
      }) <= 0) {
    throw new Error("Conservative active inventory has no Position.spent recovery basis")
  }
  if (!position &&
      (compareDecimal({
         left: ledger.buyCost,
         right: "0",
       }) > 0 ||
       compareDecimal({
         left: ledger.netSellProceeds,
         right: "0",
       }) > 0)) {
    throw new Error("Conservative RecoveryLedger has cycle accounting without an active Position")
  }
}

function resolveAccountingState({
  context,
  recoveryLedger,
}) {
  const { portfolio, marketPrice, marketMetadata, pairConfig } = context
  const position = portfolio.getPosition({
    symbol: marketPrice.symbol,
    strategyId: StrategyId.COIN_GRABBER,
  })
  const activeQuantity = position?.quantity.amount ?? "0"
  const positionSpent = position?.spent.amount ?? "0"
  const ledger = recoveryLedger ?? {
    buyCost: "0",
    netSellProceeds: "0",
  }
  if (recoveryLedger && recoveryLedger.market?.id !== marketMetadata.market.id) {
    throw new Error("Conservative RecoveryLedger market does not match strategy market")
  }
  if ((hasActivePosition({ activeQuantity }) ||
       compareDecimal({
         left: positionSpent,
         right: "0",
       }) > 0) && !recoveryLedger) {
    throw new Error("Conservative active Position requires its recovery proceeds ledger")
  }
  validateRecoveryAccounting({
    recoveryLedger,
    position,
    activeQuantity,
    positionSpent,
    ledger,
  })
  return {
    position,
    activeQuantity,
    positionSpent,
    ledger,
    outstandingRecovery: maxDecimal({
      left: "0",
      right: subtractDecimal({
        left: positionSpent,
        right: ledger.netSellProceeds,
      }),
    }),
    keepQuantity: String(pairConfig.keepQuantity),
    recoveryLedger,
  }
}
function calculateResidualSellPrice({ sellPlan, marketPrice, priceTickSize, minPrice }) {
  let residualPrice
  if (compareDecimal({ left: sellPlan.requiredNetProceeds,
right: "0" }) === 0) {
    residualPrice = roundDecimalToIncrement({
      value: marketPrice.price,
      increment: priceTickSize,
      direction: "up",
    })
  } else {
    residualPrice = sellPlan.price
  }
  if (minPrice && compareDecimal({ left: residualPrice,
right: minPrice }) < 0) {
    residualPrice = roundDecimalToIncrement({
      value: minPrice,
      increment: priceTickSize,
      direction: "up",
    })
  }
  return residualPrice
}

function evaluateSellQuantityLimits({
  sellPlan,
  residualPrice,
  quantityStepSize,
  minQuantity,
  minNotional,
  maxQuantity,
  maxNotional,
}) {
  let sellQuantity = sellPlan.quantity
  let quantityCapReason
  if (maxQuantity && compareDecimal({ left: sellQuantity,
right: maxQuantity }) > 0) {
    sellQuantity = roundDecimalToIncrement({
      value: maxQuantity,
      increment: quantityStepSize,
      direction: "down",
    })
    quantityCapReason = "MAX_QUANTITY"
  }
  if (maxNotional && compareDecimal({
    left: multiplyDecimal({ left: residualPrice,
right: sellQuantity }),
    right: maxNotional,
  }) > 0) {
    const maxNotionalQuantity = roundDecimalToIncrement({
      value: divideDecimal({
        left: maxNotional,
        right: residualPrice,
        scale: 36,
        rounding: "toward-zero",
      }),
      increment: quantityStepSize,
      direction: "down",
    })
    if (compareDecimal({ left: maxNotionalQuantity,
right: sellQuantity }) < 0) {
      sellQuantity = maxNotionalQuantity
      quantityCapReason = "MAX_NOTIONAL"
    }
  }
  const sellNotional = multiplyDecimal({
    left: residualPrice,
    right: sellQuantity,
  })
  const quantityMeetsMinimum = compareDecimal({ left: sellQuantity,
right: minQuantity }) >= 0
  const notionalMeetsMinimum = compareDecimal({ left: sellNotional,
right: minNotional }) >= 0
  return {
    sellQuantity,
    quantityCapReason,
    sellNotional,
    quantityMeetsMinimum,
    notionalMeetsMinimum,
  }
}

function createSellDustDisposition({ context, accounting, quantityLimits }) {
  return Object.freeze({
    status: "EXCHANGE_CONSTRAINED_DUST",
    quantity: subtractDecimal({
      left: accounting.activeQuantity,
      right: accounting.keepQuantity,
    }),
    reason: quantityLimits.quantityCapReason ??
      (!quantityLimits.quantityMeetsMinimum ? "MIN_QUANTITY" : "MIN_NOTIONAL"),
    minimumQuantity: context.minQuantity,
    minimumNotional: context.minNotional,
    evaluatedQuantity: quantityLimits.sellQuantity,
    evaluatedNotional: quantityLimits.sellNotional,
    ...(context.maxQuantity ? { maximumQuantity: context.maxQuantity } : {}),
    ...(context.maxNotional ? { maximumNotional: context.maxNotional } : {}),
  })
}

function createRecoverySellAction({ context, accounting, sellPlan, residualPrice, sellQuantity }) {
  return Object.freeze({
    side: "SELL",
    purpose: "RECOVERY_SELL",
    type: context.marketMetadata.orderType,
    price: residualPrice,
    quantity: sellQuantity,
    reason: hasOutstandingRecovery({
      positionSpent: accounting.positionSpent,
      netSellProceeds: accounting.ledger.netSellProceeds,
    })
      ? "RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT"
      : "SELL_RESIDUAL_INVENTORY_ABOVE_KEEP_QUANTITY",
    requiredNetProceeds: sellPlan.requiredNetProceeds,
  })
}

function createRecoverySellPlanForPosition({ context, accounting }) {
  const { feeRate } = calculateSellFeeRate({
    makerPercent: String(context.pairConfig.makerPercent),
    takerPercent: String(context.pairConfig.takerPercent),
    orderType: context.marketMetadata.orderType,
  })
  return calculateRecoverySellPlan({
    activeQuantity: accounting.activeQuantity,
    keepQuantity: accounting.keepQuantity,
    positionSpent: accounting.positionSpent,
    saleProceeds: accounting.ledger.netSellProceeds,
    minProfit: String(context.pairConfig.minProfit),
    feeRate,
    priceTickSize: context.priceTickSize,
    quantityStepSize: context.quantityStepSize,
  })
}

function createQuantityIncrementDustDisposition({ context, quantity }) {
  return Object.freeze({
    status: "EXCHANGE_CONSTRAINED_DUST",
    quantity,
    reason: "QUANTITY_INCREMENT",
    quantityStepSize: context.quantityStepSize,
    evaluatedQuantity: "0",
  })
}

function createMinimumQuantityDustDisposition({ context, quantity }) {
  return Object.freeze({
    status: "EXCHANGE_CONSTRAINED_DUST",
    quantity,
    reason: "MIN_QUANTITY",
    minimumQuantity: context.minQuantity,
    evaluatedQuantity: quantity,
  })
}

function createMinimumNotionalDustDisposition({ context, quantity, evaluatedNotional }) {
  return Object.freeze({
    status: "EXCHANGE_CONSTRAINED_DUST",
    quantity,
    reason: "MIN_NOTIONAL",
    minimumQuantity: context.minQuantity,
    minimumNotional: context.minNotional,
    evaluatedQuantity: quantity,
    evaluatedNotional,
  })
}

function resolveDustEvaluationPrice({
  context,
  marketPrice,
}) {
  let evaluatedPrice = roundDecimalToIncrement({
    value: marketPrice.price,
    increment: context.priceTickSize,
    direction: "up",
  })
  if (context.minPrice && compareDecimal({
    left: evaluatedPrice,
    right: context.minPrice,
  }) < 0) {
    evaluatedPrice = roundDecimalToIncrement({
      value: context.minPrice,
      increment: context.priceTickSize,
      direction: "up",
    })
  }
  return evaluatedPrice
}

function createUnfillableSellDisposition({
  context,
  accounting,
  marketPrice,
}) {
  const quantity = subtractDecimal({
    left: accounting.activeQuantity,
    right: accounting.keepQuantity,
  })
  const evaluatedPrice = resolveDustEvaluationPrice({
    context,
    marketPrice,
  })
  const evaluatedNotional = multiplyDecimal({
    left: evaluatedPrice,
    right: quantity,
  })
  if (compareDecimal({
    left: quantity,
    right: context.quantityStepSize,
  }) < 0) {
    return createQuantityIncrementDustDisposition({
      context,
      quantity,
    })
  }
  if (compareDecimal({
    left: quantity,
    right: context.minQuantity,
  }) < 0) {
    return createMinimumQuantityDustDisposition({
      context,
      quantity,
    })
  }
  if (compareDecimal({
    left: evaluatedNotional,
    right: context.minNotional,
  }) < 0) {
    return createMinimumNotionalDustDisposition({
      context,
      quantity,
      evaluatedNotional,
    })
  }
  return createQuantityIncrementDustDisposition({
    context,
    quantity,
  })
}

function createPriceFilterBlockedDisposition({ context, accounting, residualPrice }) {
  return Object.freeze({
    status: "PRICE_FILTER_BLOCKED",
    quantity: subtractDecimal({
      left: accounting.activeQuantity,
      right: accounting.keepQuantity,
    }),
    reason: "MAX_PRICE",
    requiredPrice: residualPrice,
    maximumPrice: context.maxPrice,
  })
}

function createRecoverySellDecisionFromPlan({
  context,
  accounting,
  sellPlan,
}) {
  const residualPrice = calculateResidualSellPrice({
    sellPlan,
    marketPrice: context.marketPrice,
    priceTickSize: context.priceTickSize,
    minPrice: context.minPrice,
  })
  if (context.maxPrice && compareDecimal({
    left: residualPrice,
    right: context.maxPrice,
  }) > 0) {
    return {
      inventoryDisposition: createPriceFilterBlockedDisposition({
        context,
        accounting,
        residualPrice,
      }),
    }
  }
  const quantityLimits = evaluateSellQuantityLimits({
    sellPlan,
    residualPrice,
    quantityStepSize: context.quantityStepSize,
    minQuantity: context.minQuantity,
    minNotional: context.minNotional,
    maxQuantity: context.maxQuantity,
    maxNotional: context.maxNotional,
  })
  if (quantityLimits.quantityMeetsMinimum && quantityLimits.notionalMeetsMinimum) {
    return {
      action: createRecoverySellAction({
        context,
        accounting,
        sellPlan,
        residualPrice,
        sellQuantity: quantityLimits.sellQuantity,
      }),
    }
  }
  return {
    inventoryDisposition: createSellDustDisposition({
      context,
      accounting,
      quantityLimits,
    }),
  }
}

function createRecoverySellDecision({
  context,
  accounting,
}) {
  if (context.hasActiveSell || !hasSellableInventory({
    activeQuantity: accounting.activeQuantity,
    keepQuantity: accounting.keepQuantity,
  })) {
    return {}
  }
  const sellPlan = createRecoverySellPlanForPosition({
    context,
    accounting,
  })
  if (compareDecimal({
    left: sellPlan.quantity,
    right: "0",
  }) <= 0) {
    return {
      inventoryDisposition: createUnfillableSellDisposition({
        context,
        accounting,
        marketPrice: context.marketPrice,
      }),
    }
  }
  return createRecoverySellDecisionFromPlan({
    context,
    accounting,
    sellPlan,
  })
}

function getBuyFilterReason({
  quantityMeetsMinimum,
  notionalMeetsMinimum,
  quantityWithinMaximum,
  notionalWithinMaximum,
  buyPrice,
  minPrice,
}) {
  if (!quantityMeetsMinimum) {return "MIN_QUANTITY"}
  if (!notionalMeetsMinimum) {return "MIN_NOTIONAL"}
  if (!quantityWithinMaximum) {return "MAX_QUANTITY"}
  if (!notionalWithinMaximum) {return "MAX_NOTIONAL"}
  if (minPrice && compareDecimal({ left: buyPrice,
right: minPrice }) < 0) {
    return "MIN_PRICE"
  }
  return "MAX_PRICE"
}

function createBuyFilterDisposition({ context, buyQuantity, buyNotional, reason }) {
  return Object.freeze({
    status: "EXCHANGE_CONSTRAINED_BUY",
    reason,
    quantity: buyQuantity,
    notional: buyNotional,
    minimumQuantity: context.minQuantity,
    minimumNotional: context.minNotional,
    ...(context.maxQuantity ? { maximumQuantity: context.maxQuantity } : {}),
    ...(context.maxNotional ? { maximumNotional: context.maxNotional } : {}),
    ...(context.minPrice ? { minimumPrice: context.minPrice } : {}),
    ...(context.maxPrice ? { maximumPrice: context.maxPrice } : {}),
  })
}

function calculateStandingBuyPrice({ context, accounting, lastBuyPrice }) {
  if (hasActivePosition({ activeQuantity: accounting.activeQuantity }) && lastBuyPrice === undefined) {
    throw new Error("Conservative active Position requires the reconciled completed-BUY VWAP before placing the next standing BUY")
  }
  const referencePrice = lastBuyPrice ?? context.marketPrice.price
  assertDecimalString({ value: referencePrice,
field: "lastBuyPrice" })
  return calculateInitialBuyPrice({
    lastTradePrice: referencePrice,
    priceStepPercent: String(context.pairConfig.priceStepPercent),
    priceTickSize: context.priceTickSize,
  }).price
}

function evaluateBuyOrderLimits({ context, accounting, buyPrice, buyQuantity, buyNotional, investmentLimit }) {
  const quantityMeetsMinimum = compareDecimal({ left: buyQuantity,
right: context.minQuantity }) >= 0
  const notionalMeetsMinimum = compareDecimal({ left: buyNotional,
right: context.minNotional }) >= 0
  const quantityWithinMaximum = !context.maxQuantity ||
    compareDecimal({ left: buyQuantity,
right: context.maxQuantity }) <= 0
  const notionalWithinMaximum = !context.maxNotional ||
    compareDecimal({ left: buyNotional,
right: context.maxNotional }) <= 0
  const priceWithinFilters =
    (!context.minPrice || compareDecimal({ left: buyPrice,
right: context.minPrice }) >= 0) &&
    (!context.maxPrice || compareDecimal({ left: buyPrice,
right: context.maxPrice }) <= 0)
  const withinInvestmentLimit = investmentLimit === undefined || compareDecimal({
    left: addDecimal({ left: accounting.outstandingRecovery,
right: buyNotional }),
    right: investmentLimit,
  }) <= 0
  return {
    quantityMeetsMinimum,
    notionalMeetsMinimum,
    quantityWithinMaximum,
    notionalWithinMaximum,
    priceWithinFilters,
    withinInvestmentLimit,
  }
}

function createStandingBuyCandidate({
  context,
  accounting,
  lastBuyPrice,
}) {
  const buyPrice = calculateStandingBuyPrice({
    context,
    accounting,
    lastBuyPrice,
  })
  const buyQuantity = roundDecimalToIncrement({
    value: String(context.pairConfig.orderQuantity),
    increment: context.quantityStepSize,
    direction: "down",
  })
  return {
    buyPrice,
    buyQuantity,
    buyNotional: compareDecimal({
      left: buyQuantity,
      right: "0",
    }) > 0
      ? multiplyDecimal({
        left: buyPrice,
        right: buyQuantity,
      })
      : "0",
    investmentLimit: context.pairConfig.investment === undefined
      ? undefined
      : String(context.pairConfig.investment),
  }
}

function canPlaceStandingBuy({
  context,
  inventoryDisposition,
}) {
  return !context.hasActiveBuy &&
    !context.hasUnacknowledgedRecoverySell &&
    inventoryDisposition?.status !== "PRICE_FILTER_BLOCKED"
}

function createStandingBuyDecisionFromCandidate({
  context,
  accounting,
  candidate,
}) {
  const limits = evaluateBuyOrderLimits({
    context,
    accounting,
    buyPrice: candidate.buyPrice,
    buyQuantity: candidate.buyQuantity,
    buyNotional: candidate.buyNotional,
    investmentLimit: candidate.investmentLimit,
  })
  if (!limits.quantityMeetsMinimum || !limits.notionalMeetsMinimum ||
      !limits.quantityWithinMaximum || !limits.notionalWithinMaximum ||
      !limits.priceWithinFilters) {
    const reason = getBuyFilterReason({
      quantityMeetsMinimum: limits.quantityMeetsMinimum,
      notionalMeetsMinimum: limits.notionalMeetsMinimum,
      quantityWithinMaximum: limits.quantityWithinMaximum,
      notionalWithinMaximum: limits.notionalWithinMaximum,
      buyPrice: candidate.buyPrice,
      minPrice: context.minPrice,
    })
    return {
      buyDisposition: createBuyFilterDisposition({
        context,
        buyQuantity: candidate.buyQuantity,
        buyNotional: candidate.buyNotional,
        reason,
      }),
    }
  }
  if (!limits.withinInvestmentLimit) {
    return {}
  }
  return {
    action: Object.freeze({
      side: "BUY",
      type: context.marketMetadata.orderType,
      price: candidate.buyPrice,
      quantity: candidate.buyQuantity,
      reason: accounting.position ? "NEXT_STANDING_BUY" : "INITIAL_BUY",
    }),
  }
}

function createStandingBuyDecision({
  context,
  accounting,
  inventoryDisposition,
  lastBuyPrice,
}) {
  if (!canPlaceStandingBuy({
    context,
    inventoryDisposition,
  })) {
    return {}
  }
  const candidate = createStandingBuyCandidate({
    context,
    accounting,
    lastBuyPrice,
  })
  if (compareDecimal({
    left: candidate.buyQuantity,
    right: "0",
  }) <= 0) {
    return {
      buyDisposition: Object.freeze({
        status: "EXCHANGE_CONSTRAINED_BUY",
        reason: "QUANTITY_INCREMENT",
        configuredQuantity: String(context.pairConfig.orderQuantity),
        quantityStepSize: context.quantityStepSize,
      }),
    }
  }
  return createStandingBuyDecisionFromCandidate({
    context,
    accounting,
    candidate,
  })
}

/**
 * Evaluate the broker-independent Conservative (Free-Roll) policy.
 *
 * A price event may produce both a standing BUY and a recovery SELL. Active
 * orders are supplied by the engine so repeated market events do not duplicate
 * either side. This function creates intents only; it never performs I/O.
 */
export function evaluateConservativeStrategy({
  marketPrice,
  pairConfig,
  settings,
  portfolio,
  recoveryLedger,
  marketMetadata,
  activeOrders = [],
  lastBuyPrice,
} = {}) {
  const context = validateStrategyInput({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    marketMetadata,
    activeOrders,
  })
  const accounting = resolveAccountingState({ context,
recoveryLedger })
  const sellDecision = createRecoverySellDecision({ context,
accounting })
  const buyDecision = createStandingBuyDecision({
    context,
    accounting,
    inventoryDisposition: sellDecision.inventoryDisposition,
    lastBuyPrice,
  })
  const actions = []
  if (sellDecision.action) {
    actions.push(sellDecision.action)
  }
  if (buyDecision.action) {
    actions.push(buyDecision.action)
  }
  const { inventoryDisposition } = sellDecision
  const { buyDisposition } = buyDecision
  return Object.freeze({
    strategy: "CONSERVATIVE",
    symbol: marketPrice.symbol,
    action: actions.length === 0 ? "NO_ACTION" : "PLACE_ORDERS",
    actions: Object.freeze(actions),
    ...(inventoryDisposition ? { inventoryDisposition } : {}),
    ...(buyDisposition ? { buyDisposition } : {}),
    reason: getNoActionReason({
      actions,
      inventoryDisposition,
      buyDisposition,
    }),
  })
}
