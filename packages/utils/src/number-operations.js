/**
 * Pure numeric helpers used by the legacy NH facade.
 */
export function roundNumber(number, decimals = 2) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 100) {
    throw new RangeError('decimals must be an integer between 0 and 100')
  }

  // The exponent-string technique below turns Infinity into NaN.
  // Preserve JavaScript's existing non-finite numeric values instead.
  if (typeof number === 'number' && !Number.isFinite(number)) {
    return number
  }

  return Number(Math.round(number + `e+${decimals}`) + `e-${decimals}`)
}

/**
 * Fix floating-point noise by rounding to a bounded number of decimal places.
 */
export function fixNumber(number, digits = 4) {
  if (!Number.isInteger(digits) || digits < 0 || digits > 100) {
    throw new RangeError('digits must be an integer between 0 and 100')
  }

  return Number(number.toFixed(digits))
}

/**
 * Return a number rounded to a significant-digit precision.
 */
export function preciseNumber(number, precision = 2) {
  if (!Number.isInteger(precision) || precision < 1 || precision > 100) {
    throw new RangeError('precision must be an integer between 1 and 100')
  }

  return Number(number.toPrecision(precision))
}
