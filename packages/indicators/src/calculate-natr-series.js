import { divideDecimal, multiplyDecimal } from "@coinzilla/utils"

import { calculateAtrSeries } from "./calculate-atr-series.js"

/**
 * Calculate normalized ATR (ATR as a percentage of the matching candle close).
 *
 * The output scale and rounding behavior are identical to calculateAtrSeries.
 * Every ATR observation is normalized using the close of the same candle.
 *
 * @param {{ candles: object[], intervalMs: number, period: number, outputScale?: number, rounding?: 'toward-zero'|'away-from-zero'|'half-up' }} options
 * @returns {Array<{openTime: number, value: string}>} Immutable NATR percentage observations.
 * @throws {TypeError|RangeError} If the candle series or calculation options are invalid.
 */
export function calculateNatrSeries({
  candles,
  intervalMs,
  period,
  outputScale = 18,
  rounding = "half-up",
} = {}) {
  const atrSeries = calculateAtrSeries({
    candles,
    intervalMs,
    period,
    outputScale,
    rounding,
  })

  return Object.freeze(atrSeries.map((observation, index) => {
    const matchingClose = candles[period - 1 + index].close
    const atrAsPercent = multiplyDecimal({
      left: observation.value,
      right: "100",
    })
    const value = divideDecimal({
      left: atrAsPercent,
      right: matchingClose,
      scale: outputScale,
      rounding,
    })
    return Object.freeze({ openTime: observation.openTime, value })
  }))
}
