import { fixNumber, preciseNumber, roundNumber } from './number-operations.js'

/**
 * Legacy numeric helper facade.
 * These methods use JavaScript Number and are not suitable for exact financial
 * arithmetic; use the decimal-string helpers for prices, quantities, and fees.
 */
export class NH {
  /** @param {number} number @param {number} [decimals=2] @returns {number} */
  static round(number) {
    const decimals = arguments[1] === undefined ? 2 : arguments[1]
    return roundNumber({ number, decimals })
  }

  /** @param {number} number @param {number} [digits=4] @returns {number} */
  static fix(number) {
    const digits = arguments[1] === undefined ? 4 : arguments[1]
    return fixNumber({ number, digits })
  }

  /** @param {number} number @param {number} [precision=2] @returns {number} */
  static precise(number) {
    const precision = arguments[1] === undefined ? 2 : arguments[1]
    return preciseNumber({ number, precision })
  }
}
