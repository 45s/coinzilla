import { assertDecimalString, compareDecimal } from "@coinzilla/utils"

/**
 * Validate the candle series and return its normalized input unchanged.
 *
 * @param {{ candles: object[], intervalMs: number, period: number }} options
 * @returns {object[]}
 * @throws {TypeError|RangeError} If candle data, period, or interval is invalid.
 */
export function validateCandles({ candles, intervalMs, period } = {}) {
  if (!Array.isArray(candles)) {
    throw new TypeError("candles must be an array")
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new TypeError("intervalMs must be a positive safe integer")
  }
  if (!Number.isSafeInteger(period) || period <= 0) {
    throw new RangeError("period must be a positive integer")
  }
  if (candles.length < period) {
    throw new RangeError("insufficient candles for the requested indicator period")
  }

  let previousOpenTime = null
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]
    if (!candle || typeof candle !== "object" || Array.isArray(candle)) {
      throw new TypeError("each candle must be an object")
    }
    if (candle.isClosed !== true) {
      throw new RangeError("indicator calculations require completed candles only")
    }
    if (!Number.isSafeInteger(candle.openTime) || candle.openTime < 0) {
      throw new RangeError("candle openTime must be a non-negative safe integer")
    }
    if (previousOpenTime !== null) {
      const expectedOpenTime = previousOpenTime + intervalMs
      if (!Number.isSafeInteger(expectedOpenTime) || candle.openTime !== expectedOpenTime) {
        throw new RangeError("candles must be strictly ordered, unique and contiguous at intervalMs")
      }
    }

    const prices = [
      ["high", candle.high],
      ["low", candle.low],
      ["close", candle.close],
    ]
    for (const [field, value] of prices) {
      assertDecimalString({ value, field: "candle " + field })
      if (compareDecimal({ left: value, right: "0" }) <= 0) {
        throw new RangeError("candle " + field + " must be positive")
      }
    }

    if (compareDecimal({ left: candle.high, right: candle.low }) < 0) {
      throw new RangeError("candle high must not be below candle low")
    }
    if (
      compareDecimal({ left: candle.close, right: candle.low }) < 0 ||
      compareDecimal({ left: candle.close, right: candle.high }) > 0
    ) {
      throw new RangeError("candle close must be within its high-low range")
    }

    previousOpenTime = candle.openTime
  }

  return candles
}
