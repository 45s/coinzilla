import { compareDecimal, maxDecimal, normalizeDecimalString } from "@coinzilla/utils"
import { normalizeSymbolInput } from "./configuration.js"

const DEFAULT_BINANCE_SPOT_BASE_URL = "https://api.binance.com"
const REQUEST_TIMEOUT_MS = 10_000

function readExactlyOneFilter(filters, filterType) {
  const matches = filters.filter((filter) => filter?.filterType === filterType)
  if (matches.length !== 1) {
    throw new Error("Binance exchangeInfo must contain exactly one " + filterType + " filter")
  }
  return matches[0]
}

function normalizePositiveExchangeDecimal(value, field) {
  let normalized
  try {
    normalized = normalizeDecimalString({ value, allowNegative: false, field })
  } catch (cause) {
    throw new TypeError("Binance " + field + " must be a valid decimal string", { cause })
  }
  if (compareDecimal({ left: normalized, right: "0" }) <= 0) {
    throw new RangeError("Binance " + field + " must be positive")
  }
  return normalized
}

function parseSymbolMetadata({ symbolInfo, requestedSymbol }) {
  if (!symbolInfo || symbolInfo.symbol !== requestedSymbol) {
    throw new Error("Binance did not return the requested symbol " + requestedSymbol)
  }
  if (symbolInfo.status !== "TRADING") {
    throw new Error("Binance symbol " + requestedSymbol + " is not currently trading")
  }
  if (symbolInfo.isSpotTradingAllowed !== true) {
    throw new Error("Binance symbol " + requestedSymbol + " is not enabled for Spot trading")
  }
  if (!symbolInfo.baseAsset || !symbolInfo.quoteAsset) {
    throw new Error("Binance symbol " + requestedSymbol + " is missing base/quote asset metadata")
  }
  if (!Array.isArray(symbolInfo.orderTypes)) {
    throw new TypeError("Binance symbol " + requestedSymbol + " has malformed supported order types")
  }
  const supportedOrderTypes = [...new Set(symbolInfo.orderTypes)]
  if (!supportedOrderTypes.includes("LIMIT")) {
    throw new Error("Binance Spot symbol " + requestedSymbol + " does not support LIMIT orders")
  }

  if (!Array.isArray(symbolInfo.filters)) {
    throw new TypeError("Binance symbol " + requestedSymbol + " has malformed exchange filters")
  }
  const priceFilter = readExactlyOneFilter(symbolInfo.filters, "PRICE_FILTER")
  const lotSizeFilter = readExactlyOneFilter(symbolInfo.filters, "LOT_SIZE")
  const tickSize = normalizePositiveExchangeDecimal(priceFilter.tickSize, "PRICE_FILTER.tickSize")
  const stepSize = normalizePositiveExchangeDecimal(lotSizeFilter.stepSize, "LOT_SIZE.stepSize")
  const minQuantity = normalizePositiveExchangeDecimal(lotSizeFilter.minQty, "LOT_SIZE.minQty")
  const maxQuantity = normalizePositiveExchangeDecimal(lotSizeFilter.maxQty, "LOT_SIZE.maxQty")

  const notionalFilters = symbolInfo.filters.filter(
    (filter) => filter?.filterType === "MIN_NOTIONAL" || filter?.filterType === "NOTIONAL",
  )
  if (notionalFilters.length === 0) {
    throw new Error("Binance exchangeInfo is missing MIN_NOTIONAL/NOTIONAL for " + requestedSymbol)
  }
  const minNotionalValues = notionalFilters.map((filter) => {
    return normalizePositiveExchangeDecimal(filter.minNotional, filter.filterType + ".minNotional")
  })
  const minNotional = minNotionalValues.reduce((highest, value) => {
    return maxDecimal({ left: highest, right: value })
  })

  return {
    symbol: requestedSymbol,
    baseAsset: symbolInfo.baseAsset,
    quoteAsset: symbolInfo.quoteAsset,
    tickSize,
    stepSize,
    minQuantity,
    maxQuantity,
    minNotional,
    supportedOrderTypes,
  }
}

async function requestJson({ fetchImpl, url, label }) {
  let response
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (cause) {
    throw new Error("Binance " + label + " request failed: " + (cause?.message ?? String(cause)), { cause })
  }
  if (!response || response.ok !== true) {
    throw new Error("Binance " + label + " request failed with HTTP status " + (response?.status ?? "unknown"))
  }
  try {
    return await response.json()
  } catch (cause) {
    throw new Error("Binance " + label + " response was not valid JSON: " + (cause?.message ?? String(cause)), { cause })
  }
}

/** Fetch public, read-only Binance Spot exchange filters and a current reference ticker price. */
export async function fetchBinanceSpotMetadata({
  symbol,
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BINANCE_SPOT_BASE_URL,
} = {}) {
  const requestedSymbol = normalizeSymbolInput(symbol)
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function")
  }
  if (typeof baseUrl !== "string" || !/^https:\/\//.test(baseUrl)) {
    throw new TypeError("baseUrl must be an HTTPS URL")
  }
  const endpoint = baseUrl.replace(/\/+$/, "")
  const encodedSymbol = encodeURIComponent(requestedSymbol)
  const exchangeInfo = await requestJson({
    fetchImpl,
    url: endpoint + "/api/v3/exchangeInfo?symbol=" + encodedSymbol,
    label: "exchangeInfo",
  })
  if (!Array.isArray(exchangeInfo?.symbols)) {
    throw new TypeError("Binance exchangeInfo response is missing its symbols array")
  }
  if (exchangeInfo.symbols.length !== 1) {
    throw new Error("Binance exchangeInfo did not return exactly one result for " + requestedSymbol)
  }
  const normalized = parseSymbolMetadata({
    symbolInfo: exchangeInfo.symbols[0],
    requestedSymbol,
  })

  const ticker = await requestJson({
    fetchImpl,
    url: endpoint + "/api/v3/ticker/price?symbol=" + encodedSymbol,
    label: "ticker price",
  })
  if (ticker?.symbol !== requestedSymbol) {
    throw new Error("Binance ticker response symbol does not match " + requestedSymbol)
  }
  const price = normalizePositiveExchangeDecimal(ticker.price, "ticker.price")
  return Object.freeze({ ...normalized, price })
}
