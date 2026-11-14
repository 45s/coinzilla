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
  if (actions.length > 0) return null

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

  const getOptionalRuleAmount = ({ type }) => {
    const rule = marketMetadata.tradingRules.constraints.find((item) =>
      item.type === type && item.status === "SUPPORTED")
    if (!rule) return undefined
    if (!rule.value || typeof rule.value.amount !== "string") {
      throw new Error("Supported exchange trading rule has no amount: " + type)
    }
    assertDecimalString({ value: rule.value.amount, field: type })
    return compareDecimal({ left: rule.value.amount, right: "0" }) > 0
      ? rule.value.amount
      : undefined
  }

  const priceTickSize = getRuleAmount({ type: "PRICE_INCREMENT" })
  const quantityStepSize = getRuleAmount({ type: "QUANTITY_INCREMENT" })
  const minQuantity = getRuleAmount({ type: "MIN_QUANTITY" })
  const minNotional = getRuleAmount({ type: "MIN_NOTIONAL" })
  const minPrice = getOptionalRuleAmount({ type: "MIN_PRICE" })
  const maxPrice = getOptionalRuleAmount({ type: "MAX_PRICE" })
  const maxQuantity = getOptionalRuleAmount({ type: "MAX_QUANTITY" })
  const maxNotional = getOptionalRuleAmount({ type: "MAX_NOTIONAL" })
  const position = portfolio.getPosition({ symbol: marketPrice.symbol, strategyId: StrategyId.COIN_GRABBER })
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
       compareDecimal({ left: positionSpent, right: "0" }) > 0) && !recoveryLedger) {
    throw new Error("Conservative active Position requires its recovery proceeds ledger")
  }
  if (recoveryLedger && position &&
      compareDecimal({ left: ledger.buyCost, right: positionSpent }) !== 0) {
    throw new Error("Conservative Position.spent and legacy RecoveryLedger cost mirror diverged")
  }
  if (hasActivePosition({ activeQuantity }) &&
      compareDecimal({ left: positionSpent, right: "0" }) <= 0) {
    throw new Error("Conservative active inventory has no Position.spent recovery basis")
  }
  if (!position &&
      (compareDecimal({ left: ledger.buyCost, right: "0" }) > 0 ||
       compareDecimal({ left: ledger.netSellProceeds, right: "0" }) > 0)) {
    throw new Error("Conservative RecoveryLedger has cycle accounting without an active Position")
  }
  const hasActiveBuy = hasActiveOrder({
    activeOrders,
    symbol: marketPrice.symbol,
    side: "BUY",
  })
  const hasActiveSell = hasActiveOrder({
    activeOrders,
    symbol: marketPrice.symbol,
    side: "SELL",
  })
  // A pending or unknown recovery SELL is not an acknowledged execution
  // commitment. Likewise, a price-filter-blocked SELL must not be bypassed
  // by creating the next standing BUY.
  const hasUnacknowledgedRecoverySell = activeOrders.some((order) =>
    order?.market?.symbol === marketPrice.symbol &&
    order.side === "SELL" &&
    (order.status === "PENDING" || order.status === "UNKNOWN"))
  const actions = []
  // The recovery ledger remains open until every exchange-sellable unit above
  // keepQuantity has been sold. This includes residual sell-through after the
  // cycle has already reached its minimum net-profit target.
  const outstandingRecovery = maxDecimal({
    left: "0",
    right: subtractDecimal({ left: positionSpent, right: ledger.netSellProceeds }),
  })
  let inventoryDisposition
  let buyDisposition
  // Submit recovery SELL first. Active orders suppress duplicate SELL intents.
  if (!hasActiveSell && hasSellableInventory({
    activeQuantity,
    keepQuantity: String(pairConfig.keepQuantity),
  })) {
    const feeRate = calculateSellFeeRate({
      makerPercent: String(pairConfig.makerPercent),
      takerPercent: String(pairConfig.takerPercent),
      orderType: marketMetadata.orderType,
    }).feeRate
    const sellPlan = calculateRecoverySellPlan({
      activeQuantity,
      keepQuantity: String(pairConfig.keepQuantity),
      positionSpent,
      saleProceeds: ledger.netSellProceeds,
      minProfit: String(pairConfig.minProfit),
      feeRate,
      priceTickSize,
      quantityStepSize,
    })
    if (compareDecimal({ left: sellPlan.quantity, right: "0" }) > 0) {
      // Once cumulative proceeds already cover cost + minProfit, price the
      // residual at the current market reference, never at an artificial
      // one-tick floor. The cycle's actual cumulative net profit remains the
      // accounting authority.
      let residualPrice = compareDecimal({
        left: sellPlan.requiredNetProceeds,
        right: "0",
      }) === 0
        ? roundDecimalToIncrement({
          value: marketPrice.price,
          increment: priceTickSize,
          direction: "up",
        })
        : sellPlan.price
      if (minPrice && compareDecimal({ left: residualPrice, right: minPrice }) < 0) {
        residualPrice = roundDecimalToIncrement({
          value: minPrice,
          increment: priceTickSize,
          direction: "up",
        })
      }

      if (maxPrice && compareDecimal({ left: residualPrice, right: maxPrice }) > 0) {
        inventoryDisposition = Object.freeze({
          status: "PRICE_FILTER_BLOCKED",
          quantity: subtractDecimal({ left: activeQuantity, right: String(pairConfig.keepQuantity) }),
          reason: "MAX_PRICE",
          requiredPrice: residualPrice,
          maximumPrice: maxPrice,
        })
      } else {
        let sellQuantity = sellPlan.quantity
        let quantityCapReason
        if (maxQuantity && compareDecimal({ left: sellQuantity, right: maxQuantity }) > 0) {
          sellQuantity = roundDecimalToIncrement({
            value: maxQuantity,
            increment: quantityStepSize,
            direction: "down",
          })
          quantityCapReason = "MAX_QUANTITY"
        }
        if (maxNotional && compareDecimal({
          left: multiplyDecimal({ left: residualPrice, right: sellQuantity }),
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
          if (compareDecimal({ left: maxNotionalQuantity, right: sellQuantity }) < 0) {
            sellQuantity = maxNotionalQuantity
            quantityCapReason = "MAX_NOTIONAL"
          }
        }
        const sellNotional = multiplyDecimal({
          left: residualPrice,
          right: sellQuantity,
        })
        const quantityMeetsMinimum = compareDecimal({
          left: sellQuantity,
          right: minQuantity,
        }) >= 0
        const notionalMeetsMinimum = compareDecimal({
          left: sellNotional,
          right: minNotional,
        }) >= 0
        if (quantityMeetsMinimum && notionalMeetsMinimum) {
          actions.push(Object.freeze({
            side: "SELL",
            purpose: "RECOVERY_SELL",
            type: marketMetadata.orderType,
            price: residualPrice,
            quantity: sellQuantity,
            reason: hasOutstandingRecovery({
              positionSpent,
              netSellProceeds: ledger.netSellProceeds,
            })
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
            reason: quantityCapReason ?? (!quantityMeetsMinimum ? "MIN_QUANTITY" : "MIN_NOTIONAL"),
            minimumQuantity: minQuantity,
            minimumNotional: minNotional,
            evaluatedQuantity: sellQuantity,
            evaluatedNotional: sellNotional,
            ...(maxQuantity ? { maximumQuantity: maxQuantity } : {}),
            ...(maxNotional ? { maximumNotional: maxNotional } : {}),
          })
        }
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
        evaluatedQuantity: "0",
      })
    }
  }

  if (!hasActiveBuy &&
      !hasUnacknowledgedRecoverySell &&
      inventoryDisposition?.status !== "PRICE_FILTER_BLOCKED") {
    if (hasActivePosition({ activeQuantity }) && lastBuyPrice === undefined) {
      throw new Error("Conservative active Position requires the reconciled completed-BUY VWAP before placing the next standing BUY")
    }
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
    const investmentLimit = pairConfig.investment === undefined ? undefined : String(pairConfig.investment)
    if (compareDecimal({ left: buyQuantity, right: "0" }) <= 0) {
      buyDisposition = Object.freeze({
        status: "EXCHANGE_CONSTRAINED_BUY",
        reason: "QUANTITY_INCREMENT",
        configuredQuantity: String(pairConfig.orderQuantity),
        quantityStepSize,
      })
    } else {
      const buyNotional = multiplyDecimal({ left: buyPrice, right: buyQuantity })
      const quantityMeetsMinimum = compareDecimal({ left: buyQuantity, right: minQuantity }) >= 0
      const notionalMeetsMinimum = compareDecimal({ left: buyNotional, right: minNotional }) >= 0
      const quantityWithinMaximum = !maxQuantity || compareDecimal({ left: buyQuantity, right: maxQuantity }) <= 0
      const notionalWithinMaximum = !maxNotional || compareDecimal({ left: buyNotional, right: maxNotional }) <= 0
      const priceWithinFilters =
        (!minPrice || compareDecimal({ left: buyPrice, right: minPrice }) >= 0) &&
        (!maxPrice || compareDecimal({ left: buyPrice, right: maxPrice }) <= 0)
      const withinInvestmentLimit = investmentLimit === undefined || compareDecimal({
        left: addDecimal({ left: outstandingRecovery, right: buyNotional }),
        right: investmentLimit,
      }) <= 0
      if (!quantityMeetsMinimum || !notionalMeetsMinimum || !quantityWithinMaximum ||
          !notionalWithinMaximum || !priceWithinFilters) {
        let filterReason
        if (!quantityMeetsMinimum) {
          filterReason = "MIN_QUANTITY"
        } else if (!notionalMeetsMinimum) {
          filterReason = "MIN_NOTIONAL"
        } else if (!quantityWithinMaximum) {
          filterReason = "MAX_QUANTITY"
        } else if (!notionalWithinMaximum) {
          filterReason = "MAX_NOTIONAL"
        } else if (minPrice && compareDecimal({ left: buyPrice, right: minPrice }) < 0) {
          filterReason = "MIN_PRICE"
        } else {
          filterReason = "MAX_PRICE"
        }
        buyDisposition = Object.freeze({
          status: "EXCHANGE_CONSTRAINED_BUY",
          reason: filterReason,
          quantity: buyQuantity,
          notional: buyNotional,
          minimumQuantity: minQuantity,
          minimumNotional: minNotional,
          ...(maxQuantity ? { maximumQuantity: maxQuantity } : {}),
          ...(maxNotional ? { maximumNotional: maxNotional } : {}),
          ...(minPrice ? { minimumPrice: minPrice } : {}),
          ...(maxPrice ? { maximumPrice: maxPrice } : {}),
        })
      } else if (withinInvestmentLimit) {
        actions.push(Object.freeze({
          side: "BUY",
          type: marketMetadata.orderType,
          price: buyPrice,
          quantity: buyQuantity,
          reason: position ? "NEXT_STANDING_BUY" : "INITIAL_BUY",
        }))
      }
    }
  }
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
