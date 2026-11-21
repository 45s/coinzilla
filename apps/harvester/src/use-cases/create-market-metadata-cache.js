import { toResult } from "@coinzilla/utils"

export const MARKET_METADATA_FRESHNESS_MAX_AGE_MS = 30_000

function readMarketMetadataClock({ now } = {}) {
  const timestamp = now()
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError("Market metadata clock must return a non-negative safe integer timestamp")
  }
  return timestamp
}

function isFreshMarketMetadata({
  cachedMetadata,
  metadata,
  symbol,
  refreshedAt,
  currentTime,
} = {}) {
  const matchesMarket = cachedMetadata?.market?.id === metadata?.market?.id &&
    cachedMetadata?.market?.symbol === symbol
  const age = refreshedAt === undefined ? undefined : currentTime - refreshedAt
  return matchesMarket && age >= 0 && age < MARKET_METADATA_FRESHNESS_MAX_AGE_MS
}

/**
 * Creates a process-local cache for validated exchange market filters.
 *
 * @param {object} options Cache dependencies.
 * @param {Function} options.getMarketMetadata Startup metadata lookup.
 * @param {Function} options.getSymbolFilters Current exchange-filter lookup.
 * @param {Function} options.validateMarketMetadata Market-readiness validator.
 * @param {Function} [options.now=Date.now] Injectable millisecond clock.
 * @returns {object} Cached metadata access and refresh operations.
 */
export function createMarketMetadataCache({
  getMarketMetadata,
  getSymbolFilters,
  validateMarketMetadata,
  now = Date.now,
} = {}) {
  for (const [name, callback] of Object.entries({
    getMarketMetadata,
    getSymbolFilters,
    validateMarketMetadata,
    now,
  })) {
    if (typeof callback !== "function") {
      throw new TypeError(`${name} must be a function`)
    }
  }
  const refreshedMarketMetadata = new Map()
  const refreshedAtBySymbol = new Map()
  const getCurrentMarketMetadata = ({ symbol } = {}) =>
    refreshedMarketMetadata.get(symbol) ?? getMarketMetadata({ symbol })
  const refreshMarketMetadata = async ({
    symbol,
    pairConfig,
    metadata,
    force = false,
  } = {}) => {
    try {
      const currentTime = readMarketMetadataClock({ now })
      const cachedMetadata = refreshedMarketMetadata.get(symbol)
      const refreshedAt = refreshedAtBySymbol.get(symbol)
      if (!force && isFreshMarketMetadata({
        cachedMetadata,
        metadata,
        symbol,
        refreshedAt,
        currentTime,
      })) {
        return toResult({ data: cachedMetadata })
      }
      const result = await getSymbolFilters({ symbol })
      if (!result?.ok || !result.data) {
        throw result?.errors?.[0] ?? new Error(`Fresh Binance exchange metadata is unavailable for ${symbol}`)
      }
      const refreshed = validateMarketMetadata({
        symbol,
        pairConfig,
        marketMetadata: result.data,
      })
      if (refreshed?.market?.id !== metadata?.market?.id || refreshed?.market?.symbol !== symbol) {
        throw new Error(`Fresh exchange metadata does not match the active market ${symbol}`)
      }
      const refreshedAt = readMarketMetadataClock({ now })
      refreshedMarketMetadata.set(symbol, refreshed)
      refreshedAtBySymbol.set(symbol, refreshedAt)
      return toResult({ data: refreshed })
    } catch (error) {
      return toResult({ error })
    }
  }
  return {
    refreshedMarketMetadata,
    getCurrentMarketMetadata,
    refreshMarketMetadata,
  }
}
