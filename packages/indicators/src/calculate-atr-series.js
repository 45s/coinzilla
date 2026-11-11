import {
  addDecimal,
  absoluteDecimal,
  divideDecimal,
  maxDecimal,
  multiplyDecimal,
  subtractDecimal,
  validateDecimalScale,
} from "@coinzilla/utils"

import { validateCandles } from "./validate-candles.js"

function calculateTrueRange({ candle, previousClose }) {
  const candleRange = subtractDecimal({ left: candle.high, right: candle.low })
  if (previousClose === null) {
    return candleRange
  }

  const highToPreviousClose = absoluteDecimal({
    value: subtractDecimal({ left: candle.high, right: previousClose }),
  })
  const lowToPreviousClose = absoluteDecimal({
    value: subtractDecimal({ left: candle.low, right: previousClose }),
  })
  const gapRange = maxDecimal({
    left: highToPreviousClose,
    right: lowToPreviousClose,
  })

  return maxDecimal({ left: candleRange, right: gapRange })
}

/**
 * Calculate historical ATR using the standard initial simple average followed
 * by Wilder's recursive smoothing.
 *
 * Inputs must be completed, contiguous candles. Price fields are exact decimal
 * strings. The initial ATR is the mean of the first period true ranges, where
 * the first candle's true range is its high-low range. Subsequent values use
 * ((previous ATR * (period - 1)) + current true range) / period.
 *
 * Division is rounded to outputScale fractional digits using the selected
 * exact-decimal rounding mode; the default is 18 digits and half-up rounding.
 *
 * @param {{ candles: object[], intervalMs: number, period: number, outputScale?: number, rounding?: 'toward-zero'|'away-from-zero'|'half-up' }} options
 * @returns {Array<{openTime: number, value: string}>} Immutable ATR observations.
 * @throws {TypeError|RangeError} If the input series or calculation options are invalid.
 */
export function calculateAtrSeries({
  candles,
  intervalMs,
  period,
  outputScale = 18,
  rounding = "half-up",
} = {}) {
  validateDecimalScale({ scale: outputScale })
  validateCandles({ candles, intervalMs, period })

  const trueRanges = []
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]
    const previousClose = index === 0 ? null : candles[index - 1].close
    trueRanges.push(calculateTrueRange({ candle, previousClose }))
  }

  const initialRangeTotal = trueRanges
    .slice(0, period)
    .reduce((total, trueRange) => addDecimal({ left: total, right: trueRange }), "0")
  let previousAtr = divideDecimal({
    left: initialRangeTotal,
    right: String(period),
    scale: outputScale,
    rounding,
  })

  const observations = [{
    openTime: candles[period - 1].openTime,
    value: previousAtr,
  }]

  for (let index = period; index < trueRanges.length; index += 1) {
    const weightedPreviousAtr = multiplyDecimal({
      left: previousAtr,
      right: String(period - 1),
    })
    const smoothedTotal = addDecimal({
      left: weightedPreviousAtr,
      right: trueRanges[index],
    })
    previousAtr = divideDecimal({
      left: smoothedTotal,
      right: String(period),
      scale: outputScale,
      rounding,
    })
    observations.push({
      openTime: candles[index].openTime,
      value: previousAtr,
    })
  }

  return Object.freeze(observations.map((observation) => Object.freeze(observation)))
}
