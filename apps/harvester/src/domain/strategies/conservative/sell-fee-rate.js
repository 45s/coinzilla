import {
  assertDecimalString,
  compareDecimal,
  maxDecimal,
  percentageToRate,
} from "@coinzilla/utils"

/**
 * Resolve the Conservative strategy's planning fee reserve from configured
 * fee percentages and actual commission rates observed on this pair.
 *
 * Configured rates are not charged fees and are never booked as accounting.
 * The configured ceiling is activated only after an actual non-zero
 * commission has been observed, matching the Free-Roll specification.
 *
 * @param {object} input
 * @param {string} input.makerPercent Human-readable percentage (0.075 = 0.075%).
 * @param {string} input.takerPercent Human-readable percentage (0.075 = 0.075%).
 * @param {string[]} input.observedCommissionRates Actual rates from reconciled fills.
 * @returns {{ feeRate: string }} Conservative decimal fraction for sell planning.
 */
export function calculateSellFeeRate({
  makerPercent,
  takerPercent,
  observedCommissionRates = [],
} = {}) {
  assertDecimalString({ value: makerPercent, field: "makerPercent" })
  assertDecimalString({ value: takerPercent, field: "takerPercent" })

  if (
    compareDecimal({ left: makerPercent, right: "0" }) < 0 ||
    compareDecimal({ left: makerPercent, right: "100" }) >= 0 ||
    compareDecimal({ left: takerPercent, right: "0" }) < 0 ||
    compareDecimal({ left: takerPercent, right: "100" }) >= 0
  ) {
    throw new RangeError("Maker and taker percentages must be from 0 inclusive to 100 exclusive")
  }
  if (
    !Array.isArray(observedCommissionRates) ||
    observedCommissionRates.some((rate) => typeof rate !== "string")
  ) {
    throw new TypeError("observedCommissionRates must be an array of decimal strings")
  }

  let actualRate = "0"
  for (const [index, rate] of observedCommissionRates.entries()) {
    assertDecimalString({ value: rate, field: `observedCommissionRates[${index}]` })
    if (compareDecimal({ left: rate, right: "0" }) < 0) {
      throw new RangeError("Observed commission rates must be non-negative")
    }
    actualRate = maxDecimal({ left: actualRate, right: rate })
  }

  if (compareDecimal({ left: actualRate, right: "0" }) === 0) {
    return Object.freeze({ feeRate: "0" })
  }

  const configuredCeiling = compareDecimal({ left: makerPercent, right: "0" }) === 0
    ? "0"
    : maxDecimal({
      left: percentageToRate({ percent: makerPercent }),
      right: percentageToRate({ percent: takerPercent }),
    })

  return Object.freeze({
    feeRate: maxDecimal({ left: configuredCeiling, right: actualRate }),
  })
}
