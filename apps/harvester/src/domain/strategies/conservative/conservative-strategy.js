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
  const minQuantity = getRuleAmount({ type: "MIN_QUANTITY" })
  const minNotional = getRuleAmount({ type: "MIN_NOTIONAL" })
  const position = portfolio.getPosition({ symbol: marketPrice.symbol })
  const activeQuantity = position?.baseQuantity.amount ?? "0"
  const ledger = recoveryLedger ?? {
    buyCost: "0",
    netSellProceeds: "0",
  }
  if (compareDecimal({ left: activeQuantity, right: "0" }) > 0 &&
      compareDecimal({ left: ledger.buyCost, right: "0" }) === 0 &&
      compareDecimal({ left: ledger.netSellProceeds, right: "0" }) === 0) {
    throw new Error("Conservative active inventory has no recovery cost/profit basis")
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

  // The recovery ledger remains open until every exchange-sellable unit above
  // keepQuantity has been sold. This includes residual sell-through after the
  // cycle has already reached its minimum net-profit target.
  const outstandingRecovery = ledger.outstandingRecoveryAmount ?? maxDecimal({
    left: "0",
    right: subtractDecimal({ left: ledger.buyCost, right: ledger.netSellProceeds }),
  })
  let inventoryDisposition
  // Submit recovery SELL first. Active orders suppress duplicate SELL intents.
  if (!hasActiveSell &&
      compareDecimal({ left: activeQuantity, right: String(pairConfig.keepQuantity) }) > 0) {
    const feeRate = calculateSellFeeRate({
      makerPercent: String(pairConfig.makerPercent),
      takerPercent: String(pairConfig.takerPercent),
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
      // Once cumulative proceeds already cover cost + minProfit, price the
      // residual at the current market reference, never at an artificial
      // one-tick floor. The cycle's actual cumulative net profit remains the
      // accounting authority.
      const residualPrice = compareDecimal({
        left: sellPlan.requiredNetProceeds,
        right: "0",
      }) === 0
        ? maxDecimal({
          left: sellPlan.price,
          right: roundDecimalToIncrement({
            value: marketPrice.price,
            increment: priceTickSize,
            direction: "up",
          }),
        })
        : sellPlan.price
      const sellNotional = multiplyDecimal({
        left: residualPrice,
        right: sellPlan.quantity,
      })
      const quantityMeetsMinimum = compareDecimal({
        left: sellPlan.quantity,
        right: minQuantity,
      }) >= 0
      const notionalMeetsMinimum = compareDecimal({
        left: sellNotional,
        right: minNotional,
      }) >= 0
      if (quantityMeetsMinimum && notionalMeetsMinimum) {
        actions.push(Object.freeze({
          side: "SELL",
          type: marketMetadata.orderType,
          price: residualPrice,
          quantity: sellPlan.quantity,
          reason: compareDecimal({ left: outstandingRecovery, right: "0" }) > 0
            ? "RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT"
            : "SELL_RESIDUAL_INVENTORY_ABOVE_KEEP_QUANTITY",
          requiredNetProceeds: sellPlan.requiredNetProceeds,
        }))
      } else {
        inventoryDisposition = Object.freeze({
          status: "EXCHANGE_CONSTRAINED_DUST",
          quantity: subtractDecimal({
            left: activeQuantity,
            right: String(pairConfig.keepQuantity),
          }),
          reason: !quantityMeetsMinimum ? "MIN_QUANTITY" : "MIN_NOTIONAL",
          minimumQuantity: minQuantity,
          minimumNotional: minNotional,
          evaluatedNotional: sellNotional,
        })
      }
    } else {
      inventoryDisposition = Object.freeze({
        status: "EXCHANGE_CONSTRAINED_DUST",
        quantity: subtractDecimal({
          left: activeQuantity,
          right: String(pairConfig.keepQuantity),
        }),
        reason: "QUANTITY_INCREMENT",
        quantityStepSize,
      })
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
    ...(inventoryDisposition ? { inventoryDisposition } : {}),
    reason: actions.length === 0
      ? inventoryDisposition
        ? "Residual inventory is currently below exchange SELL filters and is classified as dust"
        : "Required standing orders are already active or no sellable recovery inventory is available"
      : null,
  })
}
