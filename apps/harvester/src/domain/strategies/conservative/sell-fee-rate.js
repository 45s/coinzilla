import {
  assertDecimalString,
  compareDecimal,
  percentageToRate,
} from "@coinzilla/utils"

/**
 * Convert configured makerPercent into the fee reserve used for recovery SELL
 * planning. The estimate is always derived from makerPercent alone.
 *
 * @param {object} input
 * @param {string} input.makerPercent Human-readable percentage (0.1 = 0.1%).
 * @returns {{ feeRate: string }} Decimal fraction (0.001 = 0.1%).
 */
export function calculateSellFeeRate({ makerPercent } = {}) {
  assertDecimalString({ value: makerPercent, field: "makerPercent" })

  if (
    compareDecimal({ left: makerPercent, right: "0" }) < 0 ||
    compareDecimal({ left: makerPercent, right: "100" }) >= 0
  ) {
    throw new RangeError("Maker percentage must be from 0 inclusive to 100 exclusive")
  }

  return Object.freeze({
    feeRate: percentageToRate({ percent: makerPercent }),
  })
}
