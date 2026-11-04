import { Market, TradingRules } from "@coinzilla/entities"
import { compareDecimal, roundDecimalToIncrement } from "@coinzilla/utils"

const REQUIRED_RULE_TYPES = Object.freeze([
  "PRICE_INCREMENT",
  "QUANTITY_INCREMENT",
  "MIN_QUANTITY",
  "MIN_NOTIONAL",
])

/**
 * Validate that one enabled pair has the exchange metadata required to plan
 * Conservative spot LIMIT orders. This is a pure domain policy.
 */
export function validateMarketTradingReadiness({
  symbol,
  pairConfig,
  marketMetadata,
} = {}) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError("validateMarketTradingReadiness requires a symbol")
  }
  if (!pairConfig || typeof pairConfig !== "object" || Array.isArray(pairConfig)) {
    throw new TypeError("validateMarketTradingReadiness requires pairConfig")
  }
  if (!marketMetadata || typeof marketMetadata !== "object" || Array.isArray(marketMetadata)) {
    throw new TypeError("validateMarketTradingReadiness requires marketMetadata")
  }

  const { market, tradingRules, supportedOrderTypes } = marketMetadata
  if (!(market instanceof Market)) {
    throw new TypeError("Market metadata must contain a canonical Market")
  }
  if (market.symbol !== symbol.trim().toUpperCase()) {
    throw new Error("Market metadata symbol does not match configured pair " + symbol)
  }
  if (!(tradingRules instanceof TradingRules) || tradingRules.market.id !== market.id) {
    throw new TypeError("Market metadata must contain TradingRules for the same Market")
  }
  if (!Array.isArray(supportedOrderTypes)) {
    throw new TypeError("Market metadata supportedOrderTypes must be an array")
  }

  for (const type of REQUIRED_RULE_TYPES) {
    const constraint = tradingRules.constraints.find((item) => item.type === type)
    if (!constraint || constraint.status !== "SUPPORTED") {
      throw new Error("Required exchange trading rule is unavailable: " + type + " for " + symbol)
    }
  }

  if (typeof pairConfig.orderQuantity !== "number" ||
      !Number.isFinite(pairConfig.orderQuantity) ||
      pairConfig.orderQuantity <= 0) {
    throw new TypeError("pairConfig.orderQuantity must be a positive finite number")
  }
  if (typeof pairConfig.investment !== "number" ||
      !Number.isFinite(pairConfig.investment) ||
      pairConfig.investment <= 0) {
    throw new TypeError("pairConfig.investment must be a positive finite number")
  }

  const constraints = new Map(tradingRules.constraints.map((item) => [item.type, item]))
  const quantityIncrement = constraints.get("QUANTITY_INCREMENT").value.amount
  const effectiveOrderQuantity = roundDecimalToIncrement({
    value: String(pairConfig.orderQuantity),
    increment: quantityIncrement,
    direction: "down",
  })
  if (compareDecimal({
    left: effectiveOrderQuantity,
    right: constraints.get("MIN_QUANTITY").value.amount,
  }) < 0) {
    throw new RangeError(
      "Configured orderQuantity for " + symbol + " (" + market.baseAsset.code +
      ") is below exchange MIN_QUANTITY after step rounding",
    )
  }

  const maxQuantity = constraints.get("MAX_QUANTITY")
  if (maxQuantity?.status === "SUPPORTED" &&
      compareDecimal({
        left: effectiveOrderQuantity,
        right: maxQuantity.value.amount,
      }) > 0) {
    throw new RangeError(
      "Configured orderQuantity for " + symbol + " (" + market.baseAsset.code +
      ") exceeds exchange MAX_QUANTITY after step rounding",
    )
  }

  if (compareDecimal({
    left: String(pairConfig.investment),
    right: constraints.get("MIN_NOTIONAL").value.amount,
  }) < 0) {
    throw new RangeError(
      "Configured investment for " + symbol + " (" + market.quoteAsset.code +
      ") is below exchange MIN_NOTIONAL",
    )
  }

  if (typeof pairConfig.makerPercent !== "number" ||
      !Number.isFinite(pairConfig.makerPercent) ||
      pairConfig.makerPercent < 0) {
    throw new TypeError("pairConfig.makerPercent must be a non-negative finite number")
  }
  const orderType = pairConfig.makerPercent === 0 ? "LIMIT_MAKER" : "LIMIT"
  if (!supportedOrderTypes.includes(orderType)) {
    throw new Error("Exchange does not support required " + orderType + " orders for " + symbol)
  }

  return Object.freeze({
    market,
    tradingRules,
    supportedOrderTypes: Object.freeze([...supportedOrderTypes]),
    orderType,
  })
}
