import { toResult } from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { createMarketPrice } from "../domain/market-price.js"

export function makeProcessMarketPrice({ strategy } = {}) {
  if (strategy === null || typeof strategy?.evaluate !== "function") {
    throw new TypeError("makeProcessMarketPrice requires a strategy with evaluate()")
  }

  return async function processMarketPrice({
    symbol,
    priceEvent,
    pairConfig,
    settings,
    portfolio = new Portfolio(),
  } = {}) {
    try {
      if (typeof symbol !== "string" || !symbol.trim()) {
        throw new TypeError("processMarketPrice requires a market symbol")
      }
      const marketPrice = createMarketPrice({ priceEvent })
      if (marketPrice.symbol !== symbol) {
        throw new TypeError("Received price for " + marketPrice.symbol + " while subscribed to " + symbol)
      }
      if (pairConfig === null || typeof pairConfig !== "object" || Array.isArray(pairConfig)) {
        throw new TypeError("processMarketPrice requires a pairConfig object")
      }
      if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
        throw new TypeError("processMarketPrice requires a settings object")
      }
      if (!(portfolio instanceof Portfolio)) {
        throw new TypeError("processMarketPrice requires a Portfolio")
      }

      const decision = await strategy.evaluate({ marketPrice, pairConfig, settings, portfolio })
      return toResult({ data: { marketPrice, decision } })
    } catch (error) {
      return toResult({ error })
    }
  }
}
