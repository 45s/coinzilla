const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/

function isDecimal(value) {
  return typeof value === "string" && DECIMAL_PATTERN.test(value)
}

function isPositiveDecimal(value) {
  return isDecimal(value) && /[1-9]/.test(value)
}

/** Pure validation: no filesystem, clock, broker, or logging dependencies. */
export function validateMarketHistory(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Market history must be a JSON object")
  }
  if (typeof input.symbol !== "string" || !/^[A-Z0-9]+$/.test(input.symbol)) {
    throw new TypeError("Market history has an invalid symbol")
  }
  if (typeof input.interval !== "string" || input.interval.length === 0) {
    throw new TypeError("Market history has an invalid interval")
  }
  if (!Array.isArray(input.history) || input.history.length === 0) {
    throw new TypeError("Market history must contain at least one candle")
  }
  if (input.data_points !== undefined && input.data_points !== input.history.length) {
    throw new RangeError("Market history data_points does not match the candle count")
  }

  let previousTimestamp = -1
  const history = input.history.map((candle, index) => {
    if (!candle || typeof candle !== "object" || Array.isArray(candle)) {
      throw new TypeError(`Candle ${index} must be an object`)
    }
    if (!Number.isSafeInteger(candle.timestamp) || candle.timestamp <= previousTimestamp) {
      throw new RangeError(`Candle ${index} has an invalid or non-ascending timestamp`)
    }
    for (const field of ["open", "high", "low", "close", "volume"]) {
      if (!isDecimal(candle[field])) throw new TypeError(`Candle ${index} has an invalid ${field}`)
    }
    if (!isPositiveDecimal(candle.close)) {
      throw new TypeError(`Candle ${index} close must be greater than zero`)
    }
    if (candle.close_time !== undefined &&
        (!Number.isSafeInteger(candle.close_time) || candle.close_time < candle.timestamp)) {
      throw new TypeError(`Candle ${index} has an invalid close_time`)
    }
    previousTimestamp = candle.timestamp
    return Object.freeze({ ...candle })
  })

  return Object.freeze({
    symbol: input.symbol,
    interval: input.interval,
    history: Object.freeze(history),
  })
}
