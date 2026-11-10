import { assertDecimalString, compareDecimal } from "@coinzilla/utils"

/**
 * Validate a required positive decimal filter returned by Binance.
 *
 * @param {{value: string|null|undefined, name: string, symbol: string}} options
 * @returns {string} The unchanged exact decimal string.
 * @throws {Error|TypeError} If the filter is missing, malformed, or not positive.
 */
export function validatePositiveDecimalFilter({ value, name, symbol }) {
  if (value === undefined || value === null) {
    throw new Error(`Binance ${name} missing for ${symbol}`)
  }
  try {
    assertDecimalString({ value, field: name })
  } catch (error) {
    throw new TypeError(`Binance ${name} is invalid for ${symbol}`, { cause: error })
  }
  if (compareDecimal({ left: value, right: "0" }) <= 0) {
    throw new Error(`Binance ${name} missing or non-positive for ${symbol}`)
  }
  return value
}

/**
 * Validate an optional non-negative decimal filter returned by Binance.
 *
 * @param {{value: string|null|undefined, name: string, symbol: string}} options
 * @returns {string|undefined} The unchanged exact decimal string, or undefined when absent.
 * @throws {TypeError|RangeError} If a provided filter is malformed or negative.
 */
export function readOptionalDecimalFilter({ value, name, symbol }) {
  if (value === undefined || value === null) return undefined
  try {
    assertDecimalString({ value, field: name })
  } catch (error) {
    throw new TypeError(`Binance ${name} is invalid for ${symbol}`, { cause: error })
  }
  if (compareDecimal({ left: value, right: "0" }) < 0) {
    throw new RangeError(`Binance ${name} must be non-negative for ${symbol}`)
  }
  return value
}
