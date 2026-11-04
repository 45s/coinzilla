import { assertDecimalString, compareDecimal } from "@coinzilla/utils"

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
