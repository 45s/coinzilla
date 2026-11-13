import { isCanonicalNonNegativeSafeInteger } from "../time/is-canonical-non-negative-safe-integer.js"
import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
  divideDecimal,
} from "@coinzilla/utils"
import {
  calculateAtrSeries,
  calculateNatrSeries,
  calculateVolatilityRatio,
} from "@coinzilla/indicators"

/** Validate one normalized candle for the requested market and timeframe. */
export function validateCandle({ candle, symbol, interval, intervalMs } = {}) {
  if (typeof symbol !== "string" || symbol.length === 0) {
    throw new TypeError("candle symbol must be a non-empty string")
  }
  if (typeof interval !== "string" || interval.length === 0) {
    throw new TypeError("candle interval must be a non-empty string")
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new RangeError("candle intervalMs must be a positive safe integer")
  }
  if (!candle || typeof candle !== "object" || Array.isArray(candle)) {
    throw new TypeError("candle must be an object")
  }
  if (candle.symbol !== symbol || candle.interval !== interval) {
    throw new RangeError("candle market or interval does not match its subscription")
  }
  if (
    !isCanonicalNonNegativeSafeInteger(candle.openTime) ||
    candle.openTime % intervalMs !== 0
  ) {
    throw new RangeError("candle openTime must align to its UTC interval")
  }
  if (
    !isCanonicalNonNegativeSafeInteger(candle.closeTime) ||
    candle.closeTime !== candle.openTime + intervalMs - 1
  ) {
    throw new RangeError("candle closeTime does not match its interval")
  }
  if (typeof candle.isClosed !== "boolean") {
    throw new TypeError("candle isClosed must be a boolean")
  }

  const decimalFields = ["open", "high", "low", "close", "volume"]
  for (const field of decimalFields) {
    assertDecimalString({ value: candle[field], field: "candle " + field })
  }
  for (const field of ["open", "high", "low", "close"]) {
    if (compareDecimal({ left: candle[field], right: "0" }) <= 0) {
      throw new RangeError("candle " + field + " must be positive")
    }
  }
  if (compareDecimal({ left: candle.volume, right: "0" }) < 0) {
    throw new RangeError("candle volume must be non-negative")
  }
  if (compareDecimal({ left: candle.high, right: candle.low }) < 0) {
    throw new RangeError("candle high must not be below candle low")
  }
  for (const field of ["open", "close"]) {
    if (
      compareDecimal({ left: candle[field], right: candle.low }) < 0 ||
      compareDecimal({ left: candle[field], right: candle.high }) > 0
    ) {
      throw new RangeError("candle " + field + " must be within its high-low range")
    }
  }

  return Object.freeze({ ...candle })
}

/** Validate a strictly ordered, contiguous candle series for one market. */
export function validateCandleSeries({ candles, symbol, interval, intervalMs } = {}) {
  if (!Array.isArray(candles)) {
    throw new TypeError("candle history must be an array")
  }

  const validated = []
  let previousOpenTime = null
  for (let index = 0; index < candles.length; index += 1) {
    const candle = validateCandle({ candle: candles[index], symbol, interval, intervalMs })
    if (!candle.isClosed && index !== candles.length - 1) {
      throw new RangeError("only the final historical candle may still be forming")
    }
    if (previousOpenTime !== null && candle.openTime !== previousOpenTime + intervalMs) {
      throw new RangeError("candle history must be strictly ordered and contiguous")
    }
    validated.push(candle)
    previousOpenTime = candle.openTime
  }
  return validated
}

/** Compare canonical candle facts without considering object identity. */
export function areCandlesEqual(left, right) {
  return [
    "symbol",
    "interval",
    "openTime",
    "closeTime",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "isClosed",
  ].every((field) => left[field] === right[field])
}

/**
 * Calculate Harvester's parameterized ATR/NATR and current/reference ratio.
 * Thresholds and protection transitions deliberately remain in the consumer.
 */
export function calculateVolatilityMetrics({
  candles,
  intervalMs,
  period,
  referenceObservations,
  indicatorScale,
  ratioScale,
} = {}) {
  if (!Array.isArray(candles)) {
    throw new TypeError("volatility metrics candles must be an array")
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new RangeError("volatility metrics intervalMs must be a positive safe integer")
  }
  if (!Number.isSafeInteger(period) || period < 1) {
    throw new RangeError("volatility metrics period must be a positive integer")
  }
  if (!Number.isSafeInteger(referenceObservations) || referenceObservations < 1) {
    throw new RangeError("volatility referenceObservations must be a positive integer")
  }
  if (!Number.isSafeInteger(indicatorScale) || indicatorScale < 0 || indicatorScale > 100) {
    throw new RangeError("volatility indicatorScale must be an integer from 0 to 100")
  }
  if (!Number.isSafeInteger(ratioScale) || ratioScale < 0 || ratioScale > 100) {
    throw new RangeError("volatility ratioScale must be an integer from 0 to 100")
  }
  if (candles.length < period + referenceObservations) {
    return { metrics: null, reason: "INSUFFICIENT_HISTORY" }
  }

  const indicatorInput = {
    candles,
    intervalMs,
    period,
    outputScale: indicatorScale,
    rounding: "half-up",
  }
  const atrSeries = calculateAtrSeries(indicatorInput)
  const natrSeries = calculateNatrSeries(indicatorInput)
  const currentNatr = natrSeries.at(-1)
  const reference = natrSeries.slice(-referenceObservations - 1, -1)

  const referenceTotal = reference.reduce(
    (total, observation) => addDecimal({ left: total, right: observation.value }),
    "0",
  )
  const referenceNatr = divideDecimal({
    left: referenceTotal,
    right: String(referenceObservations),
    scale: indicatorScale,
    rounding: "half-up",
  })
  if (compareDecimal({ left: referenceNatr, right: "0" }) <= 0) {
    return { metrics: null, reason: "ZERO_REFERENCE_VOLATILITY" }
  }

  const volatilityRatio = calculateVolatilityRatio({
    current: currentNatr.value,
    reference: referenceNatr,
    outputScale: ratioScale,
    rounding: "half-up",
  })
  const metrics = Object.freeze({
    openTime: currentNatr.openTime,
    atr: atrSeries.at(-1).value,
    natr: currentNatr.value,
    referenceNatr,
    referenceObservations,
    volatilityRatio,
  })
  return { metrics, reason: null }
}
