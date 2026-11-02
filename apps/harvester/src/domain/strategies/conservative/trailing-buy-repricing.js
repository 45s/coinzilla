import { applyPercentageChange, assertDecimalString, compareDecimal } from "@coinzilla/utils"

/**
 * Decide whether a standing BUY should trail upward with the market.
 * This is a pure policy calculation; cancellation and replacement are
 * application-side effects owned by the trading engine.
 */
export function evaluateTrailingBuyRepricing({
  marketPrice,
  referencePrice,
  priceStepPercent,
} = {}) {
  for (const [field, value] of Object.entries({
    marketPrice,
    referencePrice,
    priceStepPercent,
  })) {
    assertDecimalString({ value, field })
  }
  if (
    compareDecimal({ left: marketPrice, right: "0" }) <= 0 ||
    compareDecimal({ left: referencePrice, right: "0" }) <= 0 ||
    compareDecimal({ left: priceStepPercent, right: "0" }) <= 0 ||
    compareDecimal({ left: priceStepPercent, right: "100" }) >= 0
  ) {
    throw new RangeError("Trailing BUY repricing inputs must be positive and priceStepPercent less than 100")
  }

  const adjustmentThreshold = applyPercentageChange({
    value: referencePrice,
    percent: priceStepPercent,
  })
  return Object.freeze({
    shouldReplace: compareDecimal({ left: marketPrice, right: adjustmentThreshold }) >= 0,
    adjustmentThreshold,
  })
}
