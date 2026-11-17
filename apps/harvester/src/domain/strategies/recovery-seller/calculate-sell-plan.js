import {
  DECIMAL_ROUNDING_MODES,
  DEFAULT_DECIMAL_DIVISION_SCALE,
  addDecimal,
  assertDecimalString,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  roundDecimalToIncrement,
  subtractDecimal,
} from "@coinzilla/utils"

function assertDecimal({ value, field }) {
  assertDecimalString({
    value,
    field,
  })
}

function assertNonNegative({ value, field }) {
  assertDecimal({
    value,
    field,
  })
  if (compareDecimal({
    left: value,
    right: "0",
  }) < 0) {
    throw new RangeError(`${field} must be non-negative`)
  }
}

function assertPositive({ value, field }) {
  assertDecimal({
    value,
    field,
  })
  if (compareDecimal({
    left: value,
    right: "0",
  }) <= 0) {
    throw new RangeError(`${field} must be greater than zero`)
  }
}

function validateLegacyAvailability({ legacyRemainingQuantity, verifiedUnreservedLegacyQuantity }) {
  if (compareDecimal({
    left: legacyRemainingQuantity,
    right: "0",
  }) > 0 && compareDecimal({
    left: verifiedUnreservedLegacyQuantity,
    right: "0",
  }) === 0) {
    throw new RangeError(
      "Authorized legacy inventory remains but no verified unreserved Spot quantity is available",
    )
  }
}

function validateFeeRates({ quoteFeeRate, baseFeeRate }) {
  if (compareDecimal({
    left: quoteFeeRate,
    right: "1",
  }) >= 0) {
    throw new RangeError("quoteFeeRate must be less than one")
  }
  if (compareDecimal({
    left: baseFeeRate,
    right: "1",
  }) >= 0) {
    throw new RangeError("baseFeeRate must be less than one")
  }
}

function validateInput(input) {
  const fields = [
    "recoveryQuantity",
    "configuredLegacyQuantity",
    "legacyRemainingQuantity",
    "verifiedUnreservedLegacyQuantity",
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
    assertDecimal({
      value: input[field],
      field,
    })
  }
  assertPositive({
    value: input.recoveryQuantity,
    field: "recoveryQuantity",
  })
  assertPositive({
    value: input.configuredLegacyQuantity,
    field: "configuredLegacyQuantity",
  })
  assertNonNegative({
    value: input.legacyRemainingQuantity,
    field: "legacyRemainingQuantity",
  })
  assertNonNegative({
    value: input.verifiedUnreservedLegacyQuantity,
    field: "verifiedUnreservedLegacyQuantity",
  })
  assertPositive({
    value: input.recoveryCostBasis,
    field: "recoveryCostBasis",
  })
  assertNonNegative({
    value: input.legacyAverageCost,
    field: "legacyAverageCost",
  })
  assertPositive({
    value: input.minProfit,
    field: "minProfit",
  })
  assertNonNegative({
    value: input.quoteFeeRate,
    field: "quoteFeeRate",
  })
  assertNonNegative({
    value: input.baseFeeRate,
    field: "baseFeeRate",
  })
  assertNonNegative({
    value: input.thirdAssetFeeQuoteValue,
    field: "thirdAssetFeeQuoteValue",
  })
  assertPositive({
    value: input.priceTickSize,
    field: "priceTickSize",
  })
  assertPositive({
    value: input.quantityStepSize,
    field: "quantityStepSize",
  })

  validateLegacyAvailability({
    legacyRemainingQuantity: input.legacyRemainingQuantity,
    verifiedUnreservedLegacyQuantity: input.verifiedUnreservedLegacyQuantity,
  })
  validateFeeRates({
    quoteFeeRate: input.quoteFeeRate,
    baseFeeRate: input.baseFeeRate,
  })
}

function calculateEligibleLegacyQuantity({
  configuredLegacyQuantity,
  legacyRemainingQuantity,
  verifiedUnreservedLegacyQuantity,
}) {
  if (compareDecimal({
    left: legacyRemainingQuantity,
    right: "0",
  }) === 0) {
    return "0"
  }
  let quantity = configuredLegacyQuantity
  if (compareDecimal({
    left: legacyRemainingQuantity,
    right: quantity,
  }) < 0) {
    quantity = legacyRemainingQuantity
  }
  if (compareDecimal({
    left: verifiedUnreservedLegacyQuantity,
    right: quantity,
  }) < 0) {
    quantity = verifiedUnreservedLegacyQuantity
  }
  return quantity
}

function validateLegacyCost({ legacyQuantity, legacyAverageCost }) {
  if (compareDecimal({
    left: legacyQuantity,
    right: "0",
  }) > 0 && compareDecimal({
    left: legacyAverageCost,
    right: "0",
  }) <= 0) {
    throw new RangeError("legacyAverageCost must be positive when legacy quantity is included")
  }
}

function calculateQuoteTarget({
  recoveryCostBasis,
  legacyCostBasis,
  minProfit,
  thirdAssetFeeQuoteValue,
  quoteFeeRate,
}) {
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
    right: subtractDecimal({
      left: "1",
      right: quoteFeeRate,
    }),
    scale: DEFAULT_DECIMAL_DIVISION_SCALE,
    rounding: DECIMAL_ROUNDING_MODES.AWAY_FROM_ZERO,
  })
  return Object.freeze({
    requiredNetQuoteProceeds,
    grossQuoteProceeds,
  })
}

function calculateOrderQuantities({
  recoveryQuantity,
  availableBaseQuantity,
  baseFeeRate,
  quantityStepSize,
}) {
  const quantityBeforeStep = divideDecimal({
    left: availableBaseQuantity,
    right: addDecimal({
      left: "1",
      right: baseFeeRate,
    }),
    scale: DEFAULT_DECIMAL_DIVISION_SCALE,
    rounding: DECIMAL_ROUNDING_MODES.TOWARD_ZERO,
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
  if (compareDecimal({
    left: baseDebitQuantity,
    right: availableBaseQuantity,
  }) > 0) {
    throw new RangeError(
      "Exchange quantity step cannot include the full recovery and authorized legacy quantities after base-fee gross-up",
    )
  }

  const recoverySellQuantity = divideDecimal({
    left: multiplyDecimal({
      left: quantity,
      right: recoveryQuantity,
    }),
    right: availableBaseQuantity,
    scale: DEFAULT_DECIMAL_DIVISION_SCALE,
    rounding: DECIMAL_ROUNDING_MODES.TOWARD_ZERO,
  })
  const legacySellQuantity = subtractDecimal({
    left: quantity,
    right: recoverySellQuantity,
  })
  const recoveryBaseFeeQuantity = divideDecimal({
    left: multiplyDecimal({
      left: baseFeeQuantity,
      right: recoverySellQuantity,
    }),
    right: quantity,
    scale: DEFAULT_DECIMAL_DIVISION_SCALE,
    rounding: DECIMAL_ROUNDING_MODES.TOWARD_ZERO,
  })
  const legacyBaseFeeQuantity = subtractDecimal({
    left: baseFeeQuantity,
    right: recoveryBaseFeeQuantity,
  })

  return Object.freeze({
    quantity,
    baseFeeQuantity,
    baseDebitQuantity,
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
  })
}

function calculateMinimumPrice({ grossQuoteProceeds, quantity, priceTickSize }) {
  const minimumPrice = divideDecimal({
    left: grossQuoteProceeds,
    right: quantity,
    scale: DEFAULT_DECIMAL_DIVISION_SCALE,
    rounding: DECIMAL_ROUNDING_MODES.AWAY_FROM_ZERO,
  })
  return roundDecimalToIncrement({
    value: minimumPrice,
    increment: priceTickSize,
    direction: "up",
  })
}

/**
 * Plan one combined RS SELL from recovery inventory and the eligible legacy slice.
 *
 * configuredLegacyQuantity is the per-cycle slice. legacyRemainingQuantity is
 * the authorized remainder. verifiedUnreservedLegacyQuantity must be supplied
 * from authoritative Spot custody after active reservations are deducted. If
 * legacy remains but no such quantity is available, planning fails closed.
 *
 * thirdAssetFeeQuoteValue is a required explicit quote-currency estimate. Pass
 * "0" only when no third-asset fee applies; missing/unvalued fees are not zero.
 * Configured fee rates/valuations are planning assumptions; actual fill
 * commissions remain authoritative for final accounting.
 */
export function calculateRecoverySellerSellPlan({
  recoveryQuantity,
  configuredLegacyQuantity,
  legacyRemainingQuantity,
  verifiedUnreservedLegacyQuantity,
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
    configuredLegacyQuantity,
    legacyRemainingQuantity,
    verifiedUnreservedLegacyQuantity,
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

  const legacyQuantity = calculateEligibleLegacyQuantity({
    configuredLegacyQuantity,
    legacyRemainingQuantity,
    verifiedUnreservedLegacyQuantity,
  })
  validateLegacyCost({
    legacyQuantity,
    legacyAverageCost,
  })
  const availableBaseQuantity = addDecimal({
    left: recoveryQuantity,
    right: legacyQuantity,
  })
  const quantities = calculateOrderQuantities({
    recoveryQuantity,
    availableBaseQuantity,
    baseFeeRate,
    quantityStepSize,
  })
  const legacyCostBasis = multiplyDecimal({
    left: legacyAverageCost,
    right: quantities.legacyBaseDebitQuantity,
  })
  const quoteTarget = calculateQuoteTarget({
    recoveryCostBasis,
    legacyCostBasis,
    minProfit,
    thirdAssetFeeQuoteValue,
    quoteFeeRate,
  })
  const price = calculateMinimumPrice({
    grossQuoteProceeds: quoteTarget.grossQuoteProceeds,
    quantity: quantities.quantity,
    priceTickSize,
  })

  return Object.freeze({
    ...quantities,
    price,
    recoveryQuantity,
    legacyQuantity,
    legacyCostBasis,
    requiredNetQuoteProceeds: quoteTarget.requiredNetQuoteProceeds,
    grossQuoteProceeds: quoteTarget.grossQuoteProceeds,
  })
}
