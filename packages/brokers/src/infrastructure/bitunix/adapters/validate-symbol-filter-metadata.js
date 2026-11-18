import { assertDecimalString, compareDecimal } from "@coinzilla/utils"

function validateOptionalMinimum({ value, field }) {
  if (value === undefined || value === null) {
    return
  }
  if (typeof value !== "string") {
    throw new TypeError(`Bitunix Spot ${field} must be an exact decimal string`)
  }

  assertDecimalString({
    value,
    field: `Bitunix Spot ${field}`,
  })
  if (compareDecimal({ left: value, right: "0" }) < 0) {
    throw new RangeError(`Bitunix Spot ${field} must be non-negative`)
  }
}

function validateOptionalPrecisionCount({ value, field }) {
  if (value === undefined || value === null) {
    return
  }

  const validNumber = typeof value === "number" && Number.isSafeInteger(value) && value >= 0
  const validString = typeof value === "string" &&
    /^\d+$/.test(value) &&
    Number.isSafeInteger(Number(value))
  if (!validNumber && !validString) {
    throw new TypeError(`Bitunix Spot ${field} must be a non-negative safe integer or digit string`)
  }
}

function validateOptionalPrecisionList({ value }) {
  if (value === undefined || value === null) {
    return
  }
  if (!Array.isArray(value)) {
    throw new TypeError("Bitunix Spot precisions must be an array of exact decimal strings")
  }

  for (let index = 0; index < value.length; index += 1) {
    const precision = value[index]
    const field = `Bitunix Spot precisions[${index}]`
    if (typeof precision !== "string") {
      throw new TypeError(`${field} must be an exact decimal string`)
    }
    assertDecimalString({ value: precision, field })
    if (compareDecimal({ left: precision, right: "0" }) < 0) {
      throw new RangeError(`${field} must be non-negative`)
    }
  }
}

/**
 * Validate documented Bitunix Spot pair trading metadata without normalizing
 * or inventing exchange rules. Unknown and optional values remain untouched.
 *
 * @param {{symbolInfo: Record<string, unknown>}} options
 * @returns {void}
 */
export function validateBitunixSymbolFilterMetadata({ symbolInfo } = {}) {
  if (!symbolInfo || typeof symbolInfo !== "object" || Array.isArray(symbolInfo)) {
    throw new TypeError("Bitunix Spot symbol metadata must be an object")
  }

  validateOptionalMinimum({
    value: symbolInfo.minPrice,
    field: "minPrice",
  })
  validateOptionalMinimum({
    value: symbolInfo.minVolume,
    field: "minVolume",
  })
  validateOptionalPrecisionCount({
    value: symbolInfo.basePrecision,
    field: "basePrecision",
  })
  validateOptionalPrecisionCount({
    value: symbolInfo.quotePrecision,
    field: "quotePrecision",
  })
  validateOptionalPrecisionList({
    value: symbolInfo.precisions,
  })
}
