import { toResult } from "@coinzilla/utils"
import { createMarketPrice } from "../domain/market-price.js"

/**
 * Validate a broker-normalized price event and pass domain facts plus the
 * matching pair configuration to the selected domain strategy.
 */
export function makeProcessMarketPrice({ strategy } = {}) {
  if (strategy === null || typeof strategy?.evaluate !== "function") {
    throw new TypeError("makeProcessMarketPrice requires a strategy with evaluate()")
  }

  return async function processMarketPrice({
    symbol,
    priceEvent,
    pairConfig,
    settings,
  } = {}) {
    try {
      if (typeof symbol !== "string" || !symbol.trim()) {
        throw new TypeError("processMarketPrice requires a market symbol")
      }

      const marketPrice = createMarketPrice({ priceEvent })
      if (marketPrice.symbol !== symbol) {
        throw new TypeError(`Received price for ${marketPrice.symbol} while subscribed to ${symbol}`)
      }
      if (pairConfig === null || typeof pairConfig !== "object" || Array.isArray(pairConfig)) {
        throw new TypeError("processMarketPrice requires a pairConfig object")
      }
      if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
        throw new TypeError("processMarketPrice requires a settings object")
      }

      const decision = await strategy.evaluate({
        marketPrice,
        pairConfig,
        settings,
      })

      return toResult({ data: { marketPrice, decision } })
    } catch (error) {
      return toResult({ error })
    }
  }
}
