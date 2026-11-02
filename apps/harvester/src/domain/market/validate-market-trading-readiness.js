import { Market, TradingRules } from "@coinzilla/entities"

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
