import {
  assertDecimalString,
  compareDecimal,
  maxDecimal,
  percentageToRate,
} from "@coinzilla/utils"

/**
 * Resolve the SELL fee reserve from the configured order type. LIMIT_MAKER
 * cannot execute as taker, so use the maker rate. Ordinary LIMIT orders may
 * execute in either role and reserve the higher configured rate.
 *
 * @param {object} input
 * @param {string} input.makerPercent Human-readable percentage (0.1 = 0.1%).
 * @param {string} input.takerPercent Human-readable percentage (0.1 = 0.1%).
 * @param {string} [input.orderType] LIMIT_MAKER guarantees maker execution.
 * @returns {{ feeRate: string, reservedPercent: string, reservedRole: string }}
 */
export function calculateSellFeeRate({ makerPercent, takerPercent, orderType } = {}) {
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

  const reservedRole = orderType === "LIMIT_MAKER"
    ? "MAKER"
    : compareDecimal({ left: makerPercent, right: takerPercent }) >= 0
      ? "MAKER"
      : "TAKER"
  const reservedPercent = orderType === "LIMIT_MAKER"
    ? makerPercent
    : maxDecimal({ left: makerPercent, right: takerPercent })

  return Object.freeze({
    feeRate: percentageToRate({ percent: reservedPercent }),
    reservedPercent,
    reservedRole,
  })
}
