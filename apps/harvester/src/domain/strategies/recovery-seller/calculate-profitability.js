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
    // Independent recovery gate: recover this tranche cost plus minProfit.
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
    // Independent legacy gate: recover historical basis when legacy is included.
    eligible: !legacyApplicable || compareDecimal({
      left: netProfit,
      right: "0",
    }) >= 0,
  })
}

function calculateCycleDiagnostics({ recovery, legacy, minProfit }) {
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
    recoveryEligible: recovery.eligible,
    legacyEligible: legacy.eligible,
    // The aggregate is diagnostic only; neither leg may subsidize the other.
    eligible: recovery.eligible && legacy.eligible,
  })
}

/**
 * Evaluate the independent Recovery Seller profitability gates.
 *
 * The recovery allocation must recover its BUY cost plus minProfit. When a
 * legacy slice is included, that allocation must independently recover its
 * historical basis (break even after allocated selling costs). Recovery
 * surplus cannot subsidize a legacy loss, and legacy surplus cannot subsidize
 * a recovery tranche that misses minProfit. Recovery-only cycles do not apply
 * a legacy gate.
 *
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
  const cycle = calculateCycleDiagnostics({
    recovery,
    legacy,
    minProfit,
  })

  return Object.freeze({
    recovery,
    legacy,
    cycle,
    eligible: cycle.eligible,
  })
}
