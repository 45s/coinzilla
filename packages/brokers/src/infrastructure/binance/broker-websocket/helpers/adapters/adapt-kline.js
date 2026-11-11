import { assertDecimalString, compareDecimal } from "@coinzilla/utils"
import { createStreamName } from "../../utils/streams-protocol.js"

/**
 * @typedef {object} NormalizedCandle
 * @property {string} symbol
 * @property {string} interval
 * @property {number} openTime
 * @property {number} closeTime
 * @property {string} open
 * @property {string} high
 * @property {string} low
 * @property {string} close
 * @property {string} volume
 * @property {boolean} isClosed
 */

function normalizeSymbolAndInterval({ symbol, interval } = {}) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError("Binance candle requires a non-empty symbol")
  }

  const normalizedSymbol = symbol.trim().toUpperCase()
  createStreamName("kline", { symbol: normalizedSymbol, interval })
  return { symbol: normalizedSymbol, interval }
}

function validateTimestamp(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Binance candle " + field + " must be a non-negative safe integer")
  }
}

function validateCandleDecimals({ open, high, low, close, volume }) {
  const prices = [["open", open], ["high", high], ["low", low], ["close", close]]
  for (const [field, value] of prices) {
    assertDecimalString({ value, field: "Binance candle " + field })
    if (compareDecimal({ left: value, right: "0" }) <= 0) {
      throw new RangeError("Binance candle " + field + " must be positive")
    }
  }

  assertDecimalString({ value: volume, field: "Binance candle volume" })
  if (compareDecimal({ left: volume, right: "0" }) < 0) {
    throw new RangeError("Binance candle volume must be non-negative")
  }

  if (compareDecimal({ left: high, right: low }) < 0 ||
      compareDecimal({ left: high, right: open }) < 0 ||
      compareDecimal({ left: high, right: close }) < 0) {
    throw new RangeError("Binance candle high must be greater than or equal to open, low and close")
  }
  if (compareDecimal({ left: low, right: open }) > 0 ||
      compareDecimal({ left: low, right: close }) > 0) {
    throw new RangeError("Binance candle low must be less than or equal to open and close")
  }
}

function createNormalizedCandle({
  symbol,
  interval,
  openTime,
  closeTime,
  open,
  high,
  low,
  close,
  volume,
  isClosed,
}) {
  validateTimestamp(openTime, "openTime")
  validateTimestamp(closeTime, "closeTime")
  if (closeTime < openTime) {
    throw new RangeError("Binance candle closeTime must not be before openTime")
  }
  if (typeof isClosed !== "boolean") {
    throw new TypeError("Binance candle isClosed must be a boolean")
  }

  validateCandleDecimals({ open, high, low, close, volume })

  return Object.freeze({
    symbol,
    interval,
    openTime,
    closeTime,
    open,
    high,
    low,
    close,
    volume,
    isClosed,
  })
}

/**
 * Normalize one Binance WebSocket API klines row.
 *
 * @param {{row: unknown, symbol: string, interval: string, now?: number}} options
 * @returns {NormalizedCandle}
 * @throws {TypeError|RangeError} If the row, timestamps, prices or volume are invalid.
 */
export function adaptKlineHistoryRow({ row, symbol, interval, now = Date.now() } = {}) {
  const normalized = normalizeSymbolAndInterval({ symbol, interval })
  if (!Array.isArray(row) || row.length !== 12) {
    throw new TypeError("Binance klines row must contain exactly 12 fields")
  }
  validateTimestamp(now, "now")

  const [openTime, open, high, low, close, volume, closeTime] = row
  return createNormalizedCandle({
    ...normalized,
    openTime,
    closeTime,
    open,
    high,
    low,
    close,
    volume,
    isClosed: closeTime <= now,
  })
}

/**
 * Normalize one Binance public Kline stream event.
 *
 * @param {unknown} message
 * @returns {NormalizedCandle}
 * @throws {TypeError|RangeError} If the event or candle facts are invalid.
 */
export function adaptKlineStreamMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message) || message.e !== "kline") {
    throw new TypeError("A Binance Kline event is required")
  }
  if (!message.k || typeof message.k !== "object" || Array.isArray(message.k)) {
    throw new TypeError("Binance Kline event must contain a kline object")
  }

  const normalized = normalizeSymbolAndInterval({
    symbol: message.s,
    interval: message.k.i,
  })
  if (typeof message.k.s !== "string" || message.k.s.trim().toUpperCase() !== normalized.symbol) {
    throw new TypeError("Binance Kline symbol does not match the event symbol")
  }

  return createNormalizedCandle({
    ...normalized,
    openTime: message.k.t,
    closeTime: message.k.T,
    open: message.k.o,
    high: message.k.h,
    low: message.k.l,
    close: message.k.c,
    volume: message.k.v,
    isClosed: message.k.x,
  })
}
