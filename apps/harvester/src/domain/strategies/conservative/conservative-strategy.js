import { addDecimal, assertDecimalString, compareDecimal, maxDecimal, multiplyDecimal, roundDecimalToIncrement, subtractDecimal } from "@coinzilla/utils"
import { Portfolio } from "../../portfolio/portfolio.js"
import { calculateInitialBuyPrice } from "./initial-buy-price.js"
import { calculateRecoverySellPlan } from "./recovery-sell-plan.js"
import { calculateSellFeeRate } from "./sell-fee-rate.js"

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
  if (!marketPrice || typeof marketPrice.symbol !== "string") {
    throw new TypeError("Conservative strategy requires a validated marketPrice")
  }
  if (!pairConfig || typeof pairConfig !== "object" || Array.isArray(pairConfig)) {
    throw new TypeError("Conservative strategy requires pairConfig")
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new TypeError("Conservative strategy requires settings")
  }
  if (!(portfolio instanceof Portfolio)) {
    throw new TypeError("Conservative strategy requires a Portfolio")
  }
  if (!marketMetadata?.market || marketMetadata.market.symbol !== marketPrice.symbol) {
    throw new TypeError("Conservative strategy requires matching canonical market metadata")
  }
  if (!marketMetadata?.tradingRules?.constraints || !Array.isArray(marketMetadata.tradingRules.constraints)) {
    throw new TypeError("Conservative strategy requires normalized exchange trading rules")
  }
  if (!Array.isArray(activeOrders)) {
    throw new TypeError("Conservative strategy activeOrders must be an array")
  }

  const getRuleAmount = ({ type }) => {
    const rule = marketMetadata.tradingRules.constraints.find((item) =>
      item.type === type && item.status === "SUPPORTED")
    if (!rule?.value || typeof rule.value.amount !== "string") {
      throw new Error("Required exchange trading rule is unavailable: " + type)
    }
    assertDecimalString({ value: rule.value.amount, field: type })
    if (compareDecimal({ left: rule.value.amount, right: "0" }) <= 0) {
      throw new RangeError("Exchange trading rule must be positive: " + type)
    }
    return rule.value.amount
  }

  const priceTickSize = getRuleAmount({ type: "PRICE_INCREMENT" })
  const quantityStepSize = getRuleAmount({ type: "QUANTITY_INCREMENT" })
  const position = portfolio.getPosition({ symbol: marketPrice.symbol })
  const activeQuantity = position?.baseQuantity.amount ?? "0"
  const ledger = recoveryLedger ?? {
    buyCost: "0",
    netSellProceeds: "0",
  }
  const orders = activeOrders.filter((order) => order?.market?.symbol === marketPrice.symbol)
  const hasActiveBuy = orders.some((order) =>
    order.side === "BUY" && ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.status))
  const hasActiveSell = orders.some((order) =>
    order.side === "SELL" && ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.status))
  const actions = []
  const partiallyFilledOrder = orders.find((order) =>
    order.side === "BUY" && (
      order.status === "PARTIALLY_FILLED" ||
      (order.executedQuantity?.amount && compareDecimal({ left: order.executedQuantity.amount, right: "0" }) > 0 &&
        ["PENDING", "OPEN", "UNKNOWN"].includes(order.status))
    ))
  if (partiallyFilledOrder) {
    return Object.freeze({
      strategy: "CONSERVATIVE", symbol: marketPrice.symbol, action: "NO_ACTION",
      actions: Object.freeze([]), reason: "WAIT_FOR_ORDER_TO_FINISH_AFTER_PARTIAL_FILL",
    })
  }

  // Residual active inventory alone is not a recovery obligation. After a
  // completed cycle the ledger is reset; preserve that inventory for the next
  // legitimate cycle instead of creating a new recovery SELL from it.
  const outstandingRecovery = ledger.outstandingRecoveryAmount ?? maxDecimal({
    left: "0",
    right: subtractDecimal({ left: ledger.buyCost, right: ledger.netSellProceeds }),
  })
  // Submit recovery first. The executor processes intents in order and stops on failure.
  if (!hasActiveSell &&
      compareDecimal({ left: activeQuantity, right: "0" }) > 0 &&
      compareDecimal({ left: outstandingRecovery, right: "0" }) > 0) {
    const feeRate = calculateSellFeeRate({
      makerPercent: String(pairConfig.makerPercent),
    }).feeRate
    const sellPlan = calculateRecoverySellPlan({
      activeQuantity,
      keepQuantity: String(pairConfig.keepQuantity),
      cycleCost: ledger.buyCost,
      saleProceeds: ledger.netSellProceeds,
      minProfit: String(settings.minProfit),
      feeRate,
      priceTickSize,
      quantityStepSize,
    })
    if (compareDecimal({ left: sellPlan.quantity, right: "0" }) > 0) {
      actions.push(Object.freeze({
        side: "SELL",
        type: marketMetadata.orderType,
        price: sellPlan.price,
        quantity: sellPlan.quantity,
        reason: "RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT",
        requiredNetProceeds: sellPlan.requiredNetProceeds,
      }))
    }
  }

  if (!hasActiveBuy) {
    const referencePrice = lastBuyPrice ?? marketPrice.price
    assertDecimalString({ value: referencePrice, field: "lastBuyPrice" })
    const buyPrice = calculateInitialBuyPrice({
      lastTradePrice: referencePrice,
      priceStepPercent: String(pairConfig.priceStepPercent),
      priceTickSize,
    }).price
    const buyQuantity = roundDecimalToIncrement({
      value: String(pairConfig.orderQuantity),
      increment: quantityStepSize,
      direction: "down",
    })
    if (compareDecimal({ left: buyQuantity, right: "0" }) <= 0) {
      throw new RangeError("Configured BUY quantity is below the exchange quantity step")
    }
    const buyNotional = multiplyDecimal({ left: buyPrice, right: buyQuantity })
    const investmentLimit = pairConfig.investment === undefined ? undefined : String(pairConfig.investment)
    const withinInvestmentLimit = investmentLimit === undefined || compareDecimal({
      left: addDecimal({ left: outstandingRecovery, right: buyNotional }),
      right: investmentLimit,
    }) <= 0
    if (withinInvestmentLimit) {
      actions.push(Object.freeze({
        side: "BUY",
        type: marketMetadata.orderType,
        price: buyPrice,
        quantity: buyQuantity,
        reason: position ? "NEXT_STANDING_BUY" : "INITIAL_BUY",
      }))
    }
  }
  return Object.freeze({
    strategy: "CONSERVATIVE",
    symbol: marketPrice.symbol,
    action: actions.length === 0 ? "NO_ACTION" : "PLACE_ORDERS",
    actions: Object.freeze(actions),
    reason: actions.length === 0
      ? "Required standing orders are already active or no sellable recovery inventory is available"
      : null,
  })
}
