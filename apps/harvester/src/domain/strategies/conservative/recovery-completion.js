import { assertDecimalString, compareDecimal, subtractDecimal } from "@coinzilla/utils"

/**
 * Decide whether a fully reconciled recovery SELL may complete the current
 * cycle and allocate the configured free quantity.
 *
 * This function does not mutate Position or RecoveryLedger. It allocates only
 * the configured keepQuantity after recovery obligations and minimum profit
 * are satisfied. Any additional active residual remains active inventory and
 * must not become a new recovery obligation after the ledger is reset.
 *
 * @param {object} input
 * @param {boolean} input.sellOrderFullyFilled Final reconciled recovery SELL state.
 * @param {string} input.buyCost Cumulative quote BUY cost including quote fees.
 * @param {string} input.netSellProceeds Cumulative confirmed net quote SELL proceeds.
 * @param {string} input.activeQuantity Active base inventory after all SELL fills.
 * @param {string} input.keepQuantity Exact free quantity to allocate.
 * @param {string} input.minProfit Minimum required net quote profit.
 * @returns {{ eligible: boolean, pause: boolean, reason: string | null, freeQuantity: string, realizedNetProfit: string }}
 */
export function evaluateRecoveryCompletion({
  sellOrderFullyFilled,
  buyCost,
  netSellProceeds,
  activeQuantity,
  keepQuantity,
  minProfit,
} = {}) {
  if (typeof sellOrderFullyFilled !== "boolean") {
    throw new TypeError("sellOrderFullyFilled must be a boolean")
  }
  for (const [field, value] of Object.entries({
    buyCost,
    netSellProceeds,
    activeQuantity,
    keepQuantity,
    minProfit,
  })) {
    assertDecimalString({ value, field })
  }
  if (
    compareDecimal({ left: buyCost, right: "0" }) < 0 ||
    compareDecimal({ left: netSellProceeds, right: "0" }) < 0 ||
    compareDecimal({ left: activeQuantity, right: "0" }) < 0 ||
    compareDecimal({ left: keepQuantity, right: "0" }) <= 0 ||
    compareDecimal({ left: minProfit, right: "0.01" }) < 0
  ) {
    throw new RangeError("Invalid recovery completion inputs")
  }

  const realizedNetProfit = subtractDecimal({
    left: netSellProceeds,
    right: buyCost,
  })

  if (!sellOrderFullyFilled) {
    return Object.freeze({
      eligible: false,
      pause: false,
      reason: "RECOVERY_SELL_NOT_FULLY_FILLED",
      freeQuantity: "0",
      realizedNetProfit,
    })
  }
  if (compareDecimal({ left: activeQuantity, right: keepQuantity }) < 0) {
    return Object.freeze({
      eligible: false,
      pause: true,
      reason: "INSUFFICIENT_ACTIVE_INVENTORY_FOR_FREE_ALLOCATION",
      freeQuantity: "0",
      realizedNetProfit,
    })
  }
  if (compareDecimal({ left: realizedNetProfit, right: minProfit }) < 0) {
    return Object.freeze({
      eligible: false,
      pause: true,
      reason: "RECOVERY_SELL_FAILED_MIN_PROFIT",
      freeQuantity: "0",
      realizedNetProfit,
    })
  }

  return Object.freeze({
    eligible: true,
    pause: false,
    reason: null,
    freeQuantity: keepQuantity,
    realizedNetProfit,
  })
}
