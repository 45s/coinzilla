import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  roundDecimalToIncrement,
  subtractDecimal,
} from "@coinzilla/utils"

function assertDecimal({ value, field }) {
  assertDecimalString({ value, field })
}

function assertNonNegative({ value, field }) {
  assertDecimal({ value, field })
  if (compareDecimal({ left: value, right: "0" }) < 0) {
    throw new RangeError(`${field} must be non-negative`)
  }
}

function assertPositive({ value, field }) {
  assertDecimal({ value, field })
  if (compareDecimal({ left: value, right: "0" }) <= 0) {
    throw new RangeError(`${field} must be greater than zero`)
  }
}

function validateInput(input) {
  const fields = [
    "recoveryQuantity",
    "legacyQuantity",
    "recoveryCostBasis",
    "legacyAverageCost",
    "minProfit",
    "quoteFeeRate",
    "baseFeeRate",
    "thirdAssetFeeQuoteValue",
    "priceTickSize",
    "quantityStepSize",
  ]
  for (const field of fields) {
    assertDecimal({ value: input[field], field })
  }
  assertPositive({ value: input.recoveryQuantity, field: "recoveryQuantity" })
  assertNonNegative({ value: input.legacyQuantity, field: "legacyQuantity" })
  assertPositive({ value: input.recoveryCostBasis, field: "recoveryCostBasis" })
  assertNonNegative({ value: input.legacyAverageCost, field: "legacyAverageCost" })
  assertPositive({ value: input.minProfit, field: "minProfit" })
  assertNonNegative({ value: input.quoteFeeRate, field: "quoteFeeRate" })
  assertNonNegative({ value: input.baseFeeRate, field: "baseFeeRate" })
  assertNonNegative({
    value: input.thirdAssetFeeQuoteValue,
    field: "thirdAssetFeeQuoteValue",
  })
  assertPositive({ value: input.priceTickSize, field: "priceTickSize" })
  assertPositive({ value: input.quantityStepSize, field: "quantityStepSize" })

  if (compareDecimal({ left: input.legacyQuantity, right: "0" }) > 0 &&
      compareDecimal({ left: input.legacyAverageCost, right: "0" }) <= 0) {
    throw new RangeError("legacyAverageCost must be positive when legacy quantity is included")
  }
  if (compareDecimal({ left: input.quoteFeeRate, right: "1" }) >= 0) {
    throw new RangeError("quoteFeeRate must be less than one")
  }
  if (compareDecimal({ left: input.baseFeeRate, right: "1" }) >= 0) {
    throw new RangeError("baseFeeRate must be less than one")
  }
}

function calculateOrderQuantity({ availableBaseQuantity, baseFeeRate, quantityStepSize }) {
  const quantityBeforeStep = divideDecimal({
    left: availableBaseQuantity,
    right: addDecimal({ left: "1", right: baseFeeRate }),
    scale: 36,
    rounding: "toward-zero",
  })
  const quantity = roundDecimalToIncrement({
    value: quantityBeforeStep,
    increment: quantityStepSize,
    direction: "up",
  })
  const baseFeeQuantity = multiplyDecimal({
    left: quantity,
    right: baseFeeRate,
  })
  const baseDebitQuantity = addDecimal({
    left: quantity,
    right: baseFeeQuantity,
  })
  if (compareDecimal({ left: baseDebitQuantity, right: availableBaseQuantity }) > 0) {
    throw new RangeError(
      "Exchange quantity step cannot include the full recovery and authorized legacy quantities after base-fee gross-up",
    )
  }
  return Object.freeze({ quantity, baseFeeQuantity, baseDebitQuantity })
}

/**
 * Plan one combined RS SELL from recovery inventory and the eligible legacy slice.
 * The legacy quantity is never independently screened for profitability.
 *
 * thirdAssetFeeQuoteValue is a required explicit quote-currency estimate. Pass
 * "0" only when no third-asset fee applies; missing/unvalued fees must not be
 * silently treated as zero. Configured fee rates are planning assumptions;
 * confirmed fill commissions remain authoritative for accounting.
 */
export function calculateRecoverySellerSellPlan({
  recoveryQuantity,
  legacyQuantity,
  recoveryCostBasis,
  legacyAverageCost,
  minProfit,
  quoteFeeRate,
  baseFeeRate,
  thirdAssetFeeQuoteValue,
  priceTickSize,
  quantityStepSize,
} = {}) {
  const input = {
    recoveryQuantity,
    legacyQuantity,
    recoveryCostBasis,
    legacyAverageCost,
    minProfit,
    quoteFeeRate,
    baseFeeRate,
    thirdAssetFeeQuoteValue,
    priceTickSize,
    quantityStepSize,
  }
  validateInput(input)

  const availableBaseQuantity = addDecimal({
    left: recoveryQuantity,
    right: legacyQuantity,
  })
  const legacyCostBasis = multiplyDecimal({
    left: legacyAverageCost,
    right: legacyQuantity,
  })
  const requiredNetQuoteProceeds = addDecimal({
    left: addDecimal({
      left: recoveryCostBasis,
      right: legacyCostBasis,
    }),
    right: minProfit,
  })
  const grossQuoteTarget = addDecimal({
    left: requiredNetQuoteProceeds,
    right: thirdAssetFeeQuoteValue,
  })
  const grossQuoteProceeds = divideDecimal({
    left: grossQuoteTarget,
    right: subtractDecimal({ left: "1", right: quoteFeeRate }),
    scale: 36,
    rounding: "away-from-zero",
  })
  const { quantity, baseFeeQuantity, baseDebitQuantity } = calculateOrderQuantity({
    availableBaseQuantity,
    baseFeeRate,
    quantityStepSize,
  })
  const minimumPrice = divideDecimal({
    left: grossQuoteProceeds,
    right: quantity,
    scale: 36,
    rounding: "away-from-zero",
  })
  const price = roundDecimalToIncrement({
    value: minimumPrice,
    increment: priceTickSize,
    direction: "up",
  })

  const recoverySellQuantity = divideDecimal({
    left: multiplyDecimal({ left: quantity, right: recoveryQuantity }),
    right: availableBaseQuantity,
    scale: 36,
    rounding: "toward-zero",
  })
  const legacySellQuantity = subtractDecimal({
    left: quantity,
    right: recoverySellQuantity,
  })
  const recoveryBaseFeeQuantity = divideDecimal({
    left: multiplyDecimal({ left: baseFeeQuantity, right: recoverySellQuantity }),
    right: quantity,
    scale: 36,
    rounding: "toward-zero",
  })
  const legacyBaseFeeQuantity = subtractDecimal({
    left: baseFeeQuantity,
    right: recoveryBaseFeeQuantity,
  })

  return Object.freeze({
    quantity,
    price,
    recoveryQuantity,
    legacyQuantity,
    recoverySellQuantity,
    legacySellQuantity,
    recoveryBaseDebitQuantity: addDecimal({
      left: recoverySellQuantity,
      right: recoveryBaseFeeQuantity,
    }),
    legacyBaseDebitQuantity: addDecimal({
      left: legacySellQuantity,
      right: legacyBaseFeeQuantity,
    }),
    legacyCostBasis,
    requiredNetQuoteProceeds,
    grossQuoteProceeds,
    baseFeeQuantity,
    baseDebitQuantity,
  })
}
