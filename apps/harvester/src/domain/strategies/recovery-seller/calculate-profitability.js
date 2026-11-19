import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@coinzilla/utils"

function assertNonNegative({ value, field }) {
  assertDecimalString({
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

function assertPositive({ value, field, message = `${field} must be positive` }) {
  assertNonNegative({
    value,
    field,
  })
  if (compareDecimal({
    left: value,
    right: "0",
  }) <= 0) {
    throw new RangeError(message)
  }
}

function validateProfitabilityInputs({
  recoveryCostBasis,
  recoveryNetQuoteProceeds,
  minProfit,
  legacyAverageCost,
  legacyBaseDebit,
  legacyNetQuoteProceeds,
}) {
  assertNonNegative({
    value: recoveryNetQuoteProceeds,
    field: "recoveryNetQuoteProceeds",
  })
  assertNonNegative({
    value: legacyNetQuoteProceeds,
    field: "legacyNetQuoteProceeds",
  })
  assertPositive({
    value: recoveryCostBasis,
    field: "recoveryCostBasis",
  })
  assertPositive({
    value: minProfit,
    field: "minProfit",
    message: "minProfit must be greater than zero",
  })
  assertNonNegative({
    value: legacyAverageCost,
    field: "legacyAverageCost",
  })
  assertNonNegative({
    value: legacyBaseDebit,
    field: "legacyBaseDebit",
  })

  const legacyApplicable = compareDecimal({
    left: legacyBaseDebit,
    right: "0",
  }) > 0
  if (!legacyApplicable && compareDecimal({
    left: legacyNetQuoteProceeds,
    right: "0",
  }) !== 0) {
    throw new RangeError("Legacy quote proceeds require a positive legacy base debit")
  }
  if (legacyApplicable && compareDecimal({
    left: legacyAverageCost,
    right: "0",
  }) <= 0) {
    throw new RangeError("legacyAverageCost must be positive when legacy base is debited")
  }
  return legacyApplicable
}

function calculateRecoveryAllocation({
  recoveryCostBasis,
  recoveryNetQuoteProceeds,
  minProfit,
}) {
  const netProfit = subtractDecimal({
    left: recoveryNetQuoteProceeds,
    right: recoveryCostBasis,
  })
  return Object.freeze({
    costBasis: recoveryCostBasis,
    netQuoteProceeds: recoveryNetQuoteProceeds,
    netProfit,
    minProfit,
    eligible: compareDecimal({
      left: netProfit,
      right: minProfit,
    }) >= 0,
  })
}

function calculateLegacyAllocation({
  legacyApplicable,
  legacyAverageCost,
  legacyBaseDebit,
  legacyNetQuoteProceeds,
}) {
  const costBasis = legacyApplicable
    ? multiplyDecimal({
      left: legacyAverageCost,
      right: legacyBaseDebit,
    })
    : "0"
  const netProfit = subtractDecimal({
    left: legacyNetQuoteProceeds,
    right: costBasis,
  })
  return Object.freeze({
    applicable: legacyApplicable,
    averageCost: legacyAverageCost,
    baseDebit: legacyBaseDebit,
    costBasis,
    netQuoteProceeds: legacyNetQuoteProceeds,
    netProfit,
    eligible: !legacyApplicable || compareDecimal({
      left: netProfit,
      right: "0",
    }) >= 0,
  })
}

function calculateCombinedCycle({ recovery, legacy, minProfit }) {
  const costBasis = addDecimal({
    left: recovery.costBasis,
    right: legacy.costBasis,
  })
  const netQuoteProceeds = addDecimal({
    left: recovery.netQuoteProceeds,
    right: legacy.netQuoteProceeds,
  })
  const netProfit = subtractDecimal({
    left: netQuoteProceeds,
    right: costBasis,
  })
  return Object.freeze({
    costBasis,
    netQuoteProceeds,
    netProfit,
    minProfit,
    eligible: compareDecimal({
      left: netProfit,
      right: minProfit,
    }) >= 0,
  })
}

/**
 * Evaluate the independent recovery, legacy and combined profitability gates
 * for one Recovery Seller cycle SELL.
 *
 * Recovery must earn at least minProfit, legacy must not realize a loss against
 * its fixed historical cost basis, and the combined cycle must earn at least
 * minProfit. Overall eligibility requires every applicable gate to pass.
 * All proceeds must already be net of actual quote fees and reliably valued
 * third-asset fees. legacyBaseDebit includes allocated base-asset commissions.
 */
export function calculateRecoverySellerProfitability({
  recoveryCostBasis,
  recoveryNetQuoteProceeds,
  minProfit,
  legacyAverageCost,
  legacyBaseDebit,
  legacyNetQuoteProceeds,
} = {}) {
  const legacyApplicable = validateProfitabilityInputs({
    recoveryCostBasis,
    recoveryNetQuoteProceeds,
    minProfit,
    legacyAverageCost,
    legacyBaseDebit,
    legacyNetQuoteProceeds,
  })
  const recovery = calculateRecoveryAllocation({
    recoveryCostBasis,
    recoveryNetQuoteProceeds,
    minProfit,
  })
  const legacy = calculateLegacyAllocation({
    legacyApplicable,
    legacyAverageCost,
    legacyBaseDebit,
    legacyNetQuoteProceeds,
  })
  const cycle = calculateCombinedCycle({
    recovery,
    legacy,
    minProfit,
  })
  const eligible = recovery.eligible && legacy.eligible && cycle.eligible

  return Object.freeze({
    recovery,
    legacy,
    cycle,
    eligible,
  })
}
