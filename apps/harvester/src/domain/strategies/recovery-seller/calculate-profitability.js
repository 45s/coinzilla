import {
  assertDecimalString,
  compareDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@coinzilla/utils"

function assertNonNegative({
  value,
  field,
}) {
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

function assertPositive({
  value,
  field,
  message = `${field} must be positive`,
}) {
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

  if (!legacyApplicable &&
      compareDecimal({
        left: legacyNetQuoteProceeds,
        right: "0",
      }) !== 0) {
    throw new RangeError("Legacy quote proceeds require a positive legacy base debit")
  }
  if (legacyApplicable &&
      compareDecimal({
        left: legacyAverageCost,
        right: "0",
      }) <= 0) {
    throw new RangeError("legacyAverageCost must be positive when legacy base is debited")
  }

  return legacyApplicable
}

function calculateRecoveryProfitability({
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

function calculateLegacyProfitability({
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

/**
 * Evaluate the recovery and legacy SELL profitability gates independently.
 *
 * Net proceeds must already include quote-denominated SELL commissions and
 * reliably valued third-asset commissions. legacyBaseDebit must include the
 * legacy gross base allocation plus the base-denominated SELL commission
 * quantity allocated to legacy.
 * recoveryCostBasis must include the recovery tranche's BUY costs and fees.
 *
 * @param {object} options
 * @param {string} options.recoveryCostBasis Recovery tranche quote cost basis.
 * @param {string} options.recoveryNetQuoteProceeds Net quote proceeds allocated to recovery.
 * @param {string} options.minProfit Existing pair-level minimum recovery profit.
 * @param {string} options.legacyAverageCost Fixed original legacy average cost per base unit.
 * @param {string} options.legacyBaseDebit Actual or conservatively planned legacy base debit, including base fees.
 * @param {string} options.legacyNetQuoteProceeds Net quote proceeds allocated to legacy, after quote/valued third-asset fees.
 * @returns {object} Independent gate results; overall eligibility requires both applicable gates.
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
  const recovery = calculateRecoveryProfitability({
    recoveryCostBasis,
    recoveryNetQuoteProceeds,
    minProfit,
  })
  const legacy = calculateLegacyProfitability({
    legacyApplicable,
    legacyAverageCost,
    legacyBaseDebit,
    legacyNetQuoteProceeds,
  })

  return Object.freeze({
    recovery,
    legacy,
    eligible: recovery.eligible && legacy.eligible,
  })
}
