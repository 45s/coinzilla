import { Asset, Market } from "@coinzilla/entities"

function createAsset({ code, field }) {
  if (typeof code !== "string" || !code.trim()) {
    throw new TypeError(`Bitunix market metadata is missing ${field}`)
  }
  const normalizedCode = code.trim().toUpperCase()
  return new Asset({ id: normalizedCode.toLowerCase(),
    code: normalizedCode })
}

/**
 * Convert Bitunix Spot coin-pair metadata into the canonical Market entity.
 *
 * @param {{symbolInfo: {symbol: string, base: string, quote: string, isOpen?: string}}} options
 * @returns {import("@coinzilla/entities").Market}
 */
export function createCanonicalMarket({ symbolInfo } = {}) {
  if (!symbolInfo || typeof symbolInfo !== "object" || Array.isArray(symbolInfo)) {
    throw new TypeError("Bitunix market metadata must be an object")
  }
  if (typeof symbolInfo.symbol !== "string" || !symbolInfo.symbol.trim()) {
    throw new TypeError("Bitunix market metadata is missing symbol")
  }
  if (symbolInfo.isOpen === "0" || symbolInfo.isOpen === 0 || symbolInfo.isOpen === false) {
    throw new Error(`Bitunix Spot market ${symbolInfo.symbol} is not open for trading`)
  }

  return new Market({
    venue: "bitunix",
    symbol: symbolInfo.symbol.trim().toUpperCase(),
    baseAsset: createAsset({ code: symbolInfo.base,
      field: "base asset code" }),
    quoteAsset: createAsset({ code: symbolInfo.quote,
      field: "quote asset code" }),
  })
}
