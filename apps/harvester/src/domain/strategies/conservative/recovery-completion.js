import { addDecimal, assertDecimalString, compareDecimal, subtractDecimal } from "@coinzilla/utils"

const normalizeDustDisposition = ({ inventoryDisposition, activeQuantity, keepQuantity }) => {
  if (inventoryDisposition === undefined) return undefined
  if (!inventoryDisposition || inventoryDisposition.status !== "EXCHANGE_CONSTRAINED_DUST") return undefined
  const { quantity, reason } = inventoryDisposition
  assertDecimalString({ value: quantity, field: "inventoryDisposition.quantity" })
  const expectedQuantity = subtractDecimal({ left: activeQuantity, right: keepQuantity })
  if (compareDecimal({ left: quantity, right: "0" }) <= 0 || compareDecimal({ left: quantity, right: expectedQuantity }) !== 0) return undefined
  for (const field of ["minimumQuantity", "minimumNotional", "evaluatedQuantity", "evaluatedNotional", "quantityStepSize"]) {
    if (inventoryDisposition[field] !== undefined) assertDecimalString({ value: inventoryDisposition[field], field: "inventoryDisposition." + field })
  }
  if (reason === "MIN_QUANTITY") {
    if (inventoryDisposition.minimumQuantity === undefined || inventoryDisposition.evaluatedQuantity === undefined ||
        compareDecimal({ left: inventoryDisposition.evaluatedQuantity, right: inventoryDisposition.minimumQuantity }) >= 0) return undefined
    return Object.freeze({ status: "EXCHANGE_CONSTRAINED_DUST", quantity, reason, minimumQuantity: inventoryDisposition.minimumQuantity, evaluatedQuantity: inventoryDisposition.evaluatedQuantity })
  }
  if (reason === "MIN_NOTIONAL") {
    if (inventoryDisposition.minimumQuantity === undefined || inventoryDisposition.minimumNotional === undefined ||
        inventoryDisposition.evaluatedQuantity === undefined || inventoryDisposition.evaluatedNotional === undefined ||
        compareDecimal({ left: inventoryDisposition.evaluatedQuantity, right: inventoryDisposition.minimumQuantity }) < 0 ||
        compareDecimal({ left: inventoryDisposition.evaluatedNotional, right: inventoryDisposition.minimumNotional }) >= 0) return undefined
    return Object.freeze({ status: "EXCHANGE_CONSTRAINED_DUST", quantity, reason, minimumQuantity: inventoryDisposition.minimumQuantity, minimumNotional: inventoryDisposition.minimumNotional, evaluatedQuantity: inventoryDisposition.evaluatedQuantity, evaluatedNotional: inventoryDisposition.evaluatedNotional })
  }
  if (reason === "QUANTITY_INCREMENT") {
    if (inventoryDisposition.quantityStepSize === undefined || compareDecimal({ left: quantity, right: inventoryDisposition.quantityStepSize }) >= 0) return undefined
    return Object.freeze({ status: "EXCHANGE_CONSTRAINED_DUST", quantity, reason, quantityStepSize: inventoryDisposition.quantityStepSize })
  }
  return undefined
}

/** Complete only after a reconciled recovery SELL, sufficient net profit, and exact classification of residual dust. */
export function evaluateRecoveryCompletion({ sellOrderFullyFilled, spent, netSellProceeds, activeQuantity, keepQuantity, minProfit, inventoryDisposition } = {}) {
  if (typeof sellOrderFullyFilled !== "boolean") throw new TypeError("sellOrderFullyFilled must be a boolean")
  for (const [field, value] of Object.entries({ spent, netSellProceeds, activeQuantity, keepQuantity, minProfit })) assertDecimalString({ value, field })
  if (compareDecimal({ left: spent, right: "0" }) < 0 || compareDecimal({ left: netSellProceeds, right: "0" }) < 0 ||
      compareDecimal({ left: activeQuantity, right: "0" }) < 0 || compareDecimal({ left: keepQuantity, right: "0" }) < 0 ||
      compareDecimal({ left: minProfit, right: "0.01" }) < 0) throw new RangeError("Invalid recovery completion inputs")
  const realizedNetProfit = subtractDecimal({ left: netSellProceeds, right: spent })
  const dust = normalizeDustDisposition({ inventoryDisposition, activeQuantity, keepQuantity })
  const invalidDust = inventoryDisposition?.status === "EXCHANGE_CONSTRAINED_DUST" && !dust
  const result = ({ eligible, pause, reason, freeQuantity = "0" }) => Object.freeze({ eligible, pause, reason, freeQuantity, realizedNetProfit, ...(dust ? { dust } : {}) })
  if (!sellOrderFullyFilled) return result({ eligible: false, pause: false, reason: "RECOVERY_SELL_NOT_FULLY_FILLED" })
  if (invalidDust) return result({ eligible: false, pause: true, reason: "INVALID_EXCHANGE_CONSTRAINED_DUST_EVIDENCE" })
  if (compareDecimal({ left: activeQuantity, right: keepQuantity }) < 0) return result({ eligible: false, pause: true, reason: "INSUFFICIENT_ACTIVE_INVENTORY_FOR_FREE_ALLOCATION" })
  if (compareDecimal({ left: activeQuantity, right: keepQuantity }) > 0 && !dust) {
    return result({ eligible: false, pause: false, reason: compareDecimal({ left: realizedNetProfit, right: minProfit }) < 0 ? "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY" : "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH" })
  }
  if (compareDecimal({ left: realizedNetProfit, right: minProfit }) < 0) return result({ eligible: false, pause: true, reason: "RECOVERY_SELL_FAILED_MIN_PROFIT" })
  return result({ eligible: true, pause: false, reason: null, freeQuantity: dust ? addDecimal({ left: keepQuantity, right: dust.quantity }) : keepQuantity })
}
