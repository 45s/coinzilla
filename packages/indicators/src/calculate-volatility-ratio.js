import {
  assertDecimalString,
  compareDecimal,
  divideDecimal,
  validateDecimalScale,
} from "@coinzilla/utils"

/**
 * Compare current normalized volatility with a positive reference measurement.
 *
 * The consumer selects the reference window/value; this function only performs
 * the exact ratio calculation and does not define trading thresholds or policy.
 *
 * @param {{ current: string, reference: string, outputScale?: number, rounding?: 'toward-zero'|'away-from-zero'|'half-up' }} options
 * @returns {string} Current divided by reference, rounded to outputScale.
 * @throws {TypeError|RangeError} If values or calculation options are invalid.
 */
export function calculateVolatilityRatio({
  current,
  reference,
  outputScale = 8,
  rounding = "half-up",
} = {}) {
  validateDecimalScale({ scale: outputScale })
  assertDecimalString({ value: current, field: "current volatility" })
  assertDecimalString({ value: reference, field: "reference volatility" })

  if (compareDecimal({ left: current, right: "0" }) < 0) {
    throw new RangeError("current volatility must be non-negative")
  }
  if (compareDecimal({ left: reference, right: "0" }) <= 0) {
    throw new RangeError("reference volatility must be positive")
  }

  return divideDecimal({
    left: current,
    right: reference,
    scale: outputScale,
    rounding,
  })
}
