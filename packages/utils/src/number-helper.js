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
  static fix = (number, digits = 4) => Number(number.toFixed(digits))

  /**
   * precise number "2.0456" to "2.046" with precision "4"
   * @param {*} number
   * @param {*} precision
   * @returns
   */
  static precise = (number, precision = 2) => Number(number.toPrecision(precision))
}
