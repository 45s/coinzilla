import { assertDecimalString, compareDecimal } from "@coinzilla/utils"

const KLINE_INTERVALS = new Set([
  "1",
  "3",
  "5",
  "15",
  "30",
  "60",
  "120",
  "240",
  "360",
  "720",
  "D",
  "W",
  "M",
])

function requirePositiveDecimal({ value, field }) {
  assertDecimalString({
    value,
    field,
  })
  if (compareDecimal({
    left: value,
    right: "0",
  }) <= 0) {
    throw new RangeError(`Bitunix Spot ${field} must be positive`)
  }
  return value
}

function requireKlineTimestamp({ value }) {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value))) {
    throw new TypeError("Bitunix Spot kline timestamp must be an ISO 8601 string")
  }
  return value
}

function normalizeDepthLevel({ value, side, index }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Bitunix Spot order book ${side} level ${index} must be an object`)
  }
  return {
    price: requirePositiveDecimal({
      value: value.price,
      field: `order book ${side} price`,
    }),
    quantity: requirePositiveDecimal({
      value: value.volume,
      field: `order book ${side} volume`,
    }),
  }
}

function normalizeDepthLevels({ value, side }) {
  if (value === undefined || value === null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`Bitunix Spot order book ${side} must be an array`)
  }
  return value.map((level, index) => normalizeDepthLevel({
    value: level,
    side,
    index,
  }))
}

/**
 * Adapt the documented Spot depth response without assigning meaning to the
 * exchange's precision parameter or changing its source timestamp units.
 *
 * @param {{value: object, symbol: string}} input
 * @returns {{symbol: string, timestamp?: string, asks: object[], bids: object[]}}
 */
export function adaptBitunixOrderBook({ value, symbol }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Bitunix Spot order book response must be an object")
  }
  const result = {
    symbol,
    asks: normalizeDepthLevels({
      value: value.asks,
      side: "asks",
    }),
    bids: normalizeDepthLevels({
      value: value.bids,
      side: "bids",
    }),
  }
  if (value.ts !== undefined && value.ts !== null) {
    if (typeof value.ts !== "string" || !value.ts.trim()) {
      throw new TypeError("Bitunix Spot order book timestamp must be a non-empty string")
    }
    result.timestamp = value.ts
  }
  return result
}

/**
 * Adapt the documented Spot OHLC response. The Spot documentation does not
 * define volume, so this result deliberately is not a canonical candle.
 *
 * @param {{value: object, symbol: string}} input
 * @returns {{symbol: string, open: string, high: string, low: string, close: string, timestamp: string}}
 */
export function adaptBitunixKline({ value, symbol }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Bitunix Spot kline response row must be an object")
  }
  if (typeof value.symbol !== "string" ||
      value.symbol.trim().toUpperCase() !== symbol) {
    throw new TypeError("Bitunix Spot kline response symbol does not match the requested symbol")
  }
  const open = requirePositiveDecimal({
    value: value.open,
    field: "kline open",
  })
  const high = requirePositiveDecimal({
    value: value.high,
    field: "kline high",
  })
  const low = requirePositiveDecimal({
    value: value.low,
    field: "kline low",
  })
  const close = requirePositiveDecimal({
    value: value.close,
    field: "kline close",
  })
  if (compareDecimal({ left: high, right: low }) < 0 ||
      compareDecimal({ left: high, right: open }) < 0 ||
      compareDecimal({ left: high, right: close }) < 0 ||
      compareDecimal({ left: low, right: open }) > 0 ||
      compareDecimal({ left: low, right: close }) > 0) {
    throw new RangeError("Bitunix Spot kline OHLC values are inconsistent")
  }
  return {
    symbol,
    open,
    high,
    low,
    close,
    timestamp: requireKlineTimestamp({
      value: value.ts,
    }),
  }
}

/**
 * Normalize either a single-row or array-shaped history response. The
 * exchange docs and the maintained .NET wrapper disagree on the outer shape.
 *
 * @param {{value: object|object[], symbol: string}} input
 * @returns {object[]}
 */
export function adaptBitunixKlineHistory({ value, symbol }) {
  if (value === undefined || value === null) {
    return []
  }
  const rows = Array.isArray(value) ? value : [value]
  return rows.map((row) => adaptBitunixKline({
    value: row,
    symbol,
  }))
}

/**
 * Validate and normalize Bitunix's documented interval wire values.
 *
 * @param {{interval?: string|number}} input
 * @returns {string}
 */
export function normalizeBitunixKlineInterval({ interval = "1" } = {}) {
  const normalized = String(interval)
  if (!KLINE_INTERVALS.has(normalized)) {
    throw new TypeError("Bitunix Spot kline interval is unsupported")
  }
  return normalized
}

/**
 * Build the single-page history query. Bitunix documents endTime in seconds
 * and does not document a startTime parameter or cursor pagination.
 *
 * @param {{input: object}} input
 * @returns {object}
 */
export function createBitunixKlineHistoryQuery({ input }) {
  if (input.startTime !== undefined) {
    throw new TypeError("Bitunix Spot kline history does not support startTime")
  }
  const symbol = typeof input.symbol === "string" && input.symbol.trim()
    ? input.symbol.trim().toUpperCase()
    : null
  if (!symbol) {
    throw new TypeError("Bitunix Spot getKlineHistory() requires a non-empty symbol")
  }
  const queryParams = {
    symbol,
    interval: normalizeBitunixKlineInterval({
      interval: input.interval,
    }),
  }
  if (input.endTime !== undefined) {
    const endTime = typeof input.endTime === "string" && /^\d+$/.test(input.endTime)
      ? Number(input.endTime)
      : input.endTime
    if (!Number.isSafeInteger(endTime) || endTime < 1) {
      throw new RangeError("Bitunix Spot kline history endTime must be a positive Unix timestamp in seconds")
    }
    queryParams.endTime = String(endTime)
  }
  const limit = input.limit === undefined ? 200 : input.limit
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError("Bitunix Spot kline history limit must be an integer between 1 and 500")
  }
  queryParams.limit = String(limit)
  return {
    queryParams,
  }
}
