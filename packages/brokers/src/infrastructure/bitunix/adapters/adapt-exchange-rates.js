import { assertDecimalString, compareDecimal } from "@coinzilla/utils"

/**
 * Validate and preserve the public Bitunix Spot exchange-rate records.
 *
 * @param {{value: unknown}} input
 * @returns {ReadonlyArray<{baseSymbol: string, quoteSymbol: string, rate: string}>}
 */
export function adaptExchangeRates({ value }) {
  if (!Array.isArray(value)) {
    throw new TypeError("Bitunix Spot exchange rates response must be an array")
  }

  return Object.freeze(value.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new TypeError(`Bitunix Spot exchange rate row ${index} must be an object`)
    }
    for (const field of ["baseSymbol", "quoteSymbol"]) {
      if (typeof row[field] !== "string" || !row[field].trim()) {
        throw new TypeError(`Bitunix Spot exchange rate row ${index} requires a non-empty ${field}`)
      }
    }
    assertDecimalString({
      value: row.rate,
      field: `Bitunix Spot exchange rate row ${index} rate`,
    })
    if (compareDecimal({
      left: row.rate,
      right: "0",
    }) <= 0) {
      throw new RangeError(`Bitunix Spot exchange rate row ${index} rate must be positive`)
    }

    return Object.freeze({
      baseSymbol: row.baseSymbol,
      quoteSymbol: row.quoteSymbol,
      rate: row.rate,
    })
  }))
}
