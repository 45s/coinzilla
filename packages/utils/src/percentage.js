import {
  addDecimal,
  assertDecimalString,
  divideDecimal,
  MAX_DECIMAL_SCALE,
  multiplyDecimal,
  subtractDecimal,
  validateDecimalScale,
} from "./decimal.js"

/**
 * Convert percentage points to a decimal rate (for example, "0.075" -> "0.00075").
 * @param {{ percent: string }} options
 * @returns {string} Exact decimal rate.
 */
export function percentageToRate({ percent } = {}) {
  assertDecimalString({ value: percent, field: "percent" })
  return multiplyDecimal({ left: percent, right: "0.01" })
}

/**
 * Calculate value multiplied by percent divided by 100 exactly.
 * @param {{ value: string, percent: string }} options
 * @returns {string}
 */
export function calculatePercentageOf({ value, percent } = {}) {
  assertDecimalString({ value, field: "value" })
  return multiplyDecimal({
    left: value,
    right: percentageToRate({ percent }),
  })
}

/**
 * Apply a signed percentage change; negative percentages represent decreases.
 * @param {{ value: string, percent: string }} options
 * @returns {string}
 */
export function applyPercentageChange({ value, percent } = {}) {
  assertDecimalString({ value, field: "value" })
  const change = calculatePercentageOf({ value, percent })
  return addDecimal({ left: value, right: change })
}

/**
 * Calculate percentage change from `from` to `to` using explicit precision
 * and rounding. A zero starting value is invalid.
 * @param {{ from: string, to: string, scale: number, rounding: 'toward-zero'|'away-from-zero'|'half-up' }} options
 * @returns {string} Percentage points at the requested scale.
 * @throws {TypeError|RangeError} For invalid decimals, scale, rounding, or zero `from`.
 */
export function calculatePercentageChange({ from, to, scale, rounding } = {}) {
  assertDecimalString({ value: from, field: "from" })
  assertDecimalString({ value: to, field: "to" })
  validateDecimalScale({ scale })

  if (scale > MAX_DECIMAL_SCALE - 2) {
    throw new RangeError(
      "scale must not exceed " + (MAX_DECIMAL_SCALE - 2) + " for percentage calculations",
    )
  }

  const difference = subtractDecimal({ left: to, right: from })
  const ratio = divideDecimal({
    left: difference,
    right: from,
    scale: scale + 2,
    rounding,
  })
  return multiplyDecimal({ left: ratio, right: "100" })
}
