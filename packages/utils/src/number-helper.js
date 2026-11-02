import { fixNumber, preciseNumber, roundNumber } from './number-operations.js'

/**
 * NH stands for "number helper".
 * Keep this class facade to preserve the package's established public API.
 */
export class NH {
  static round = (number, decimals = 2) => roundNumber(number, decimals)
  static fix = (number, digits = 4) => fixNumber(number, digits)
  static precise = (number, precision = 2) => preciseNumber(number, precision)
}
