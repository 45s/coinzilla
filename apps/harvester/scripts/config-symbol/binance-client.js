import { compareDecimal, normalizeDecimalString, roundDecimalToIncrement } from "@coinzilla/utils"
import { normalizeSymbolInput } from "./configuration.js"

const DEFAULT_BINANCE_SPOT_BASE_URL = "https://api.binance.com"
const REQUEST_TIMEOUT_MS = 10_000
const FILTERS_NOT_APPLICABLE_TO_LIMIT_ORDERS = new Set([
  "MARKET_LOT_SIZE",
  "MAX_NUM_ALGO_ORDERS",
  "MAX_NUM_ICEBERG_ORDERS",
  "ICEBERG_PARTS",
  "TRAILING_DELTA",
  "EXCHANGE_MAX_NUM_ALGO_ORDERS",
  "EXCHANGE_MAX_NUM_ICEBERG_ORDERS",
  "EXCHANGE_MAX_NUM_ORDER_LISTS",
  "MAX_NUM_ORDER_LISTS",
  "MAX_NUM_ORDER_AMENDS",
])
const KNOWN_SYMBOL_FILTERS = new Set(["PRICE_FILTER", "LOT_SIZE", "MIN_NOTIONAL", "NOTIONAL"])

function validateUniqueFilterTypes(filters, label) {
  const seen = new Set()
  for (const filter of filters) {
    if (!filter || typeof filter !== "object" || Array.isArray(filter) ||
        typeof filter.filterType !== "string" || !filter.filterType.trim()) {
      throw new TypeError("Binance " + label + " contains a malformed filter without filterType")
    }
    if (seen.has(filter.filterType)) {
      throw new Error("Binance " + label + " contains duplicate " + filter.filterType + " filters")
    }
    seen.add(filter.filterType)
  }
}

function rejectUnvalidatedFilters(filters, label, knownFilters = KNOWN_SYMBOL_FILTERS) {
  const unsupported = [...new Set(filters
    .map((filter) => filter.filterType)
    .filter((type) => !knownFilters.has(type) && !FILTERS_NOT_APPLICABLE_TO_LIMIT_ORDERS.has(type)))]
  if (unsupported.length > 0) {
    throw new Error("Binance " + label + " contains constraints not validated by Harvester's current LIMIT/LIMIT_MAKER workflow: " + unsupported.join(", "))
  }
}

function readExactlyOneFilter(filters, filterType) {
  const matches = filters.filter((filter) => filter?.filterType === filterType)
  if (matches.length !== 1) {
    throw new Error("Binance exchangeInfo must contain exactly one " + filterType + " filter")
  }
  return matches[0]
}

function normalizePositiveExchangeDecimal(value, field) {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new TypeError("Binance " + field + " must be a decimal string")
  }
  let normalized
  try {
    normalized = normalizeDecimalString({ value, allowNegative: false, field })
  } catch (cause) {
    throw new TypeError("Binance " + field + " must be a valid decimal string", { cause })
  }
  if (compareDecimal({ left: normalized, right: "0" }) <= 0) {
    throw new RangeError("Binance " + field + " must be a positive decimal increment/value")
  }
  return value
}

function parseSymbolMetadata({ symbolInfo, requestedSymbol, exchangeInfo }) {
  if (!symbolInfo || symbolInfo.symbol !== requestedSymbol) {
    throw new Error("Binance did not return the requested symbol " + requestedSymbol)
  }
  if (symbolInfo.status !== "TRADING") {
    throw new Error("Binance symbol " + requestedSymbol + " is not currently trading")
  }
  if (symbolInfo.isSpotTradingAllowed !== true) {
    throw new Error("Binance symbol " + requestedSymbol + " is not enabled for Spot trading")
  }
  if (typeof symbolInfo.baseAsset !== "string" || !symbolInfo.baseAsset || typeof symbolInfo.quoteAsset !== "string" || !symbolInfo.quoteAsset) {
    throw new Error("Binance symbol " + requestedSymbol + " is missing base/quote asset metadata")
  }
  if (!Array.isArray(symbolInfo.orderTypes)) {
    throw new TypeError("Binance symbol " + requestedSymbol + " has malformed supported order types")
  }
  const supportedOrderTypes = [...new Set(symbolInfo.orderTypes)]
  for (const requiredOrderType of ["LIMIT", "LIMIT_MAKER"]) {
    if (!supportedOrderTypes.includes(requiredOrderType)) {
      throw new Error("Binance Spot symbol " + requestedSymbol + " does not support " + requiredOrderType + " orders")
    }
  }

  const filters = symbolInfo.filters
  if (!Array.isArray(filters)) {
    throw new TypeError("Binance symbol " + requestedSymbol + " has malformed exchange filters")
  }
  validateUniqueFilterTypes(filters, "symbol filters for " + requestedSymbol)
  rejectUnvalidatedFilters(filters, "symbol " + requestedSymbol)
  const exchangeFilters = exchangeInfo.exchangeFilters
  if (!Array.isArray(exchangeFilters)) {
    throw new TypeError("Binance exchangeInfo response is missing its exchangeFilters array")
  }
  validateUniqueFilterTypes(exchangeFilters, "exchange filters")
  rejectUnvalidatedFilters(exchangeFilters, "exchange", new Set())
  const priceFilter = readExactlyOneFilter(filters, "PRICE_FILTER")
  const lotSizeFilter = readExactlyOneFilter(filters, "LOT_SIZE")
  const tickSize = normalizePositiveExchangeDecimal(priceFilter.tickSize, "PRICE_FILTER.tickSize")
  const stepSize = normalizePositiveExchangeDecimal(lotSizeFilter.stepSize, "LOT_SIZE.stepSize")
  const minQuantity = normalizePositiveExchangeDecimal(lotSizeFilter.minQty, "LOT_SIZE.minQty")
  const maxQuantity = normalizePositiveExchangeDecimal(lotSizeFilter.maxQty, "LOT_SIZE.maxQty")
  const alignedMinimumQuantity = roundDecimalToIncrement({
    value: minQuantity,
    increment: stepSize,
    direction: "down",
  })
  if (compareDecimal({ left: alignedMinimumQuantity, right: minQuantity }) !== 0) {
    throw new Error("Binance LOT_SIZE.minQty is not aligned to LOT_SIZE.stepSize")
  }
  if (compareDecimal({ left: minQuantity, right: maxQuantity }) > 0) {
    throw new Error("Binance LOT_SIZE.minQty exceeds LOT_SIZE.maxQty")
  }

  for (const filterType of ["MIN_NOTIONAL", "NOTIONAL"]) {
    if (filters.filter((filter) => filter?.filterType === filterType).length > 1) {
      throw new Error("Binance exchangeInfo contains duplicate " + filterType + " filters")
    }
  }
  const notionalFilters = filters.filter(
    (filter) => filter?.filterType === "MIN_NOTIONAL" || filter?.filterType === "NOTIONAL",
  )
  if (notionalFilters.length === 0) {
    throw new Error("Binance exchangeInfo is missing MIN_NOTIONAL/NOTIONAL for " + requestedSymbol)
  }
  const minNotionalValues = notionalFilters.map((filter) => {
    const value = normalizePositiveExchangeDecimal(filter.minNotional, filter.filterType + ".minNotional")
    return { value, normalized: normalizeDecimalString({ value, allowNegative: false }) }
  })
  const strictestMinimum = minNotionalValues.reduce((highest, current) => {
    return compareDecimal({ left: highest.normalized, right: current.normalized }) >= 0 ? highest : current
  })
  const minNotional = strictestMinimum.value

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

/**
 * Fetch public, read-only Binance Spot exchange filters and a current reference ticker price.
 *
 * @param {object} options
 * @param {string} options.symbol - Binance Spot symbol.
 * @param {typeof fetch} [options.fetchImpl=fetch] - Injectable Fetch-compatible transport.
 * @param {string} [options.baseUrl] - HTTPS Binance API base URL, primarily for isolated tests.
 * @returns {Promise<object>} Exact exchange-filter strings, supported order types, and ticker price.
 * @throws {TypeError|RangeError|Error} If the symbol, filters, order types, HTTP response, or ticker are invalid.
 */
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
  if (exchangeInfo.symbols.length === 0) {
    throw new Error("Binance Spot symbol " + requestedSymbol + " was not found")
  }
  if (exchangeInfo.symbols.length !== 1) {
    throw new Error("Binance exchangeInfo returned an ambiguous result for " + requestedSymbol)
  }
  const normalized = parseSymbolMetadata({
    symbolInfo: exchangeInfo.symbols[0],
    requestedSymbol,
    exchangeInfo,
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
