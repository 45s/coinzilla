import {
  assertDecimalString,
  compareDecimal,
  maxDecimal,
  percentageToRate,
} from "@coinzilla/utils"

/**
 * Resolve a conservative SELL fee reserve from both possible execution roles.
 * Until maker execution is guaranteed before placement, reserve the higher
 * configured maker/taker rate.
 *
 * @param {object} input
 * @param {string} input.makerPercent Human-readable percentage (0.1 = 0.1%).
 * @param {string} input.takerPercent Human-readable percentage (0.1 = 0.1%).
 * @returns {{ feeRate: string, reservedPercent: string, reservedRole: string }}
 */
export function calculateSellFeeRate({ makerPercent, takerPercent } = {}) {
  const percentages = { makerPercent, takerPercent }
  for (const [field, value] of Object.entries(percentages)) {
    assertDecimalString({ value, field })
    if (
      compareDecimal({ left: value, right: "0" }) < 0 ||
      compareDecimal({ left: value, right: "100" }) >= 0
    ) {
      throw new RangeError(field + " must be from 0 inclusive to 100 exclusive")
    }
  }

  const reservedRole = compareDecimal({ left: makerPercent, right: takerPercent }) >= 0
    ? "MAKER"
    : "TAKER"
  const reservedPercent = maxDecimal({ left: makerPercent, right: takerPercent })

  return Object.freeze({
    feeRate: percentageToRate({ percent: reservedPercent }),
    reservedPercent,
    reservedRole,
  })
}
