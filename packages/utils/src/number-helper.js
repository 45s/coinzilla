/**
 * NH stands for "number helper"
 */
export class NH {
  static round = (number, decimals = 2) => {
    // The exponent-string technique below turns Infinity into NaN.
    // Preserve JavaScript's existing non-finite numeric values instead.
    if (typeof number === 'number' && !Number.isFinite(number)) {
      return number
    }

    return Number(Math.round(number + `e+${decimals}`) + `e-${decimals}`)
  }

  /**
   * fix numbers like "1.0000000000000009"
   * @param {number} number
   * @returns number
   */
  static fix = (number, digits = 4) => {
    if (!Number.isInteger(digits) || digits < 0 || digits > 100) {
      throw new RangeError("digits must be an integer between 0 and 100")
    }

    return Number(number.toFixed(digits))
  }

  /**
   * precise number "2.0456" to "2.046" with precision "4"
   * @param {*} number
   * @param {*} precision
   * @returns
   */
  static precise = (number, precision = 2) => {
    if (!Number.isInteger(precision) || precision < 1 || precision > 100) {
      throw new RangeError("precision must be an integer between 1 and 100")
    }

    return Number(number.toPrecision(precision))
  }
}
