import {
  addDecimal,
  assertDecimalString,
  divideDecimal,
  MAX_DECIMAL_SCALE,
  multiplyDecimal,
  subtractDecimal,
  validateDecimalScale,
} from "./decimal.js"

/** Convert percentage points (for example, 0.075) into a decimal rate (0.00075). */
export function percentageToRate({ percent } = {}) {
  assertDecimalString({ value: percent, field: "percent" })
  return multiplyDecimal({ left: percent, right: "0.01" })
}

/** Calculate value * percent / 100 without floating-point conversion. */
export function calculatePercentageOf({ value, percent } = {}) {
  assertDecimalString({ value, field: "value" })
  return multiplyDecimal({
    left: value,
    right: percentageToRate({ percent }),
  })
}

/** Apply a signed percentage change; negative percentages represent decreases. */
export function applyPercentageChange({ value, percent } = {}) {
  assertDecimalString({ value, field: "value" })
  const change = calculatePercentageOf({ value, percent })
  return addDecimal({ left: value, right: change })
}

/**
 * Calculate the percentage change from one value to another.
 * Scale is the number of fractional digits in the returned percentage.
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
