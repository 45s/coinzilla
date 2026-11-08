import { Asset, Market } from "@coinzilla/entities"
import { adaptCanonicalFill } from "../../../../infrastructure/binance/adapters/adapt-canonical-fill.js"

/**
 * Build the canonical Market required to normalize trades for one symbol.
 *
 * @param {{symbol: string, exchangeInfo: {symbols?: Array<object>}}} options
 * @returns {import("@coinzilla/entities").Market}
 */
export function createCanonicalFillMarket({ symbol, exchangeInfo }) {
  const symbolMatches = Array.isArray(exchangeInfo?.symbols)
    ? exchangeInfo.symbols.filter((item) => item?.symbol === symbol)
    : []
  if (symbolMatches.length !== 1) {
    throw new Error(`Binance market metadata is missing or ambiguous for ${symbol}`)
  }

  const [symbolInfo] = symbolMatches
  if (
    typeof symbolInfo.baseAsset !== "string" ||
    !symbolInfo.baseAsset.trim() ||
    typeof symbolInfo.quoteAsset !== "string" ||
    !symbolInfo.quoteAsset.trim()
  ) {
    throw new Error(`Binance market metadata is incomplete for ${symbol}`)
  }

  const baseCode = symbolInfo.baseAsset.trim().toUpperCase()
  const quoteCode = symbolInfo.quoteAsset.trim().toUpperCase()
  return new Market({
    venue: "binance",
    symbol: symbolInfo.symbol,
    baseAsset: new Asset({ id: baseCode.toLowerCase(), code: baseCode }),
    quoteAsset: new Asset({ id: quoteCode.toLowerCase(), code: quoteCode }),
  })
}

/**
 * Normalize a Binance myTrades page into canonical Fill entities.
 *
 * @param {{trades: object[], market: import("@coinzilla/entities").Market}} options
 * @returns {import("@coinzilla/entities").Fill[]}
 */
export function adaptCanonicalFills({ trades, market }) {
  if (!Array.isArray(trades)) {
    throw new TypeError("Binance myTrades response should be an array")
  }
  return trades.map((trade) => adaptCanonicalFill({ trade, market }))
}
