import { Asset, Market } from "@coinzilla/entities"

function createAsset({ code, field }) {
  if (typeof code !== "string" || !code.trim()) {
    throw new TypeError(`Bitunix market metadata is missing ${field}`)
  }
  const normalizedCode = code.trim().toUpperCase()
  return new Asset({
    id: normalizedCode.toLowerCase(),
    code: normalizedCode,
  })
}

/**
 * Bitunix Spot pair metadata omits a symbol field. The documented pair
 * response provides base/quote, while order endpoints use concatenated names
 * such as BTCUSDT. Prefer a symbol if a response includes one.
 *
 * @param {{symbolInfo: {symbol?: string, base: string, quote: string}}} input
 * @returns {string}
 */
export function getBitunixSymbol({ symbolInfo } = {}) {
  if (!symbolInfo || typeof symbolInfo !== "object" || Array.isArray(symbolInfo)) {
    throw new TypeError("Bitunix market metadata must be an object")
  }
  if (typeof symbolInfo.base !== "string" || !symbolInfo.base.trim() ||
      typeof symbolInfo.quote !== "string" || !symbolInfo.quote.trim()) {
    throw new TypeError("Bitunix market metadata is missing base or quote asset code")
  }
  const derivedSymbol = `${symbolInfo.base.trim()}${symbolInfo.quote.trim()}`.toUpperCase()
  if (symbolInfo.symbol !== undefined && symbolInfo.symbol !== null) {
    if (typeof symbolInfo.symbol !== "string" || !symbolInfo.symbol.trim()) {
      throw new TypeError("Bitunix market metadata symbol must be a non-empty string when supplied")
    }
    if (symbolInfo.symbol.trim().toUpperCase() !== derivedSymbol) {
      throw new TypeError("Bitunix market metadata symbol must match base and quote assets")
    }
  }
  return derivedSymbol
}

/**
 * Convert Bitunix Spot coin-pair metadata into the canonical Market entity.
 *
 * @param {{symbolInfo: {symbol?: string, base: string, quote: string, isOpen?: string|number|boolean}, allowClosed?: boolean}} options
 * @returns {import("@coinzilla/entities").Market}
 */
export function createCanonicalMarket({ symbolInfo, allowClosed = false } = {}) {
  const symbol = getBitunixSymbol({ symbolInfo })
  if (!allowClosed &&
      (symbolInfo.isOpen === "0" || symbolInfo.isOpen === 0 || symbolInfo.isOpen === false)) {
    throw new Error(`Bitunix Spot market ${symbol} is not open for trading`)
  }

  return new Market({
    venue: "bitunix",
    symbol,
    baseAsset: createAsset({
      code: symbolInfo.base,
      field: "base asset code",
    }),
    quoteAsset: createAsset({
      code: symbolInfo.quote,
      field: "quote asset code",
    }),
  })
}
