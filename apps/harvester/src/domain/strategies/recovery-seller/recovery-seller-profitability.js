import {
  assertDecimalString,
  compareDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@coinzilla/utils"

function assertNonNegative({ value, field }) {
  assertDecimalString({ value, field })
  if (compareDecimal({ left: value, right: "0" }) < 0) {
    throw new RangeError(field + " must be non-negative")
  }
}

/**
 * Evaluate the recovery and legacy SELL profitability gates independently.
 *
 * Net proceeds must already include quote-denominated SELL commissions and
 * reliably valued third-asset commissions. legacyBaseDebit must include the
 * legacy gross base allocation plus any base-denominated SELL commission.
 * recoveryCostBasis must include the recovery tranche's BUY costs and fees.
 *
 * @param {object} input
 * @param {string} input.recoveryCostBasis Recovery tranche quote cost basis.
 * @param {string} input.recoveryNetQuoteProceeds Net quote proceeds allocated to recovery.
 * @param {string} input.minProfit Existing pair-level minimum recovery profit.
 * @param {string} input.legacyAverageCost Fixed original legacy average cost per base unit.
 * @param {string} input.legacyBaseDebit Actual or conservatively planned legacy base debit, including base fees.
 * @param {string} input.legacyNetQuoteProceeds Net quote proceeds allocated to legacy, after quote/valued third-asset fees.
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
  const values = {
    recoveryCostBasis,
    recoveryNetQuoteProceeds,
    minProfit,
    legacyAverageCost,
    legacyBaseDebit,
    legacyNetQuoteProceeds,
  }

  for (const [field, value] of Object.entries(values)) {
    assertDecimalString({ value, field })
  }

  assertNonNegative({
    value: recoveryCostBasis,
    field: "recoveryCostBasis",
  })
  if (compareDecimal({ left: recoveryCostBasis, right: "0" }) <= 0) {
    throw new RangeError("recoveryCostBasis must be positive")
  }
  assertNonNegative({
    value: minProfit,
    field: "minProfit",
  })
  assertNonNegative({
    value: legacyAverageCost,
    field: "legacyAverageCost",
  })
  assertNonNegative({
    value: legacyBaseDebit,
    field: "legacyBaseDebit",
  })

  if (compareDecimal({ left: minProfit, right: "0" }) <= 0) {
    throw new RangeError("minProfit must be greater than zero")
  }

  const legacyApplicable = compareDecimal({
    left: legacyBaseDebit,
    right: "0",
  }) > 0

  if (!legacyApplicable &&
      compareDecimal({ left: legacyNetQuoteProceeds, right: "0" }) !== 0) {
    throw new RangeError("Legacy quote proceeds require a positive legacy base debit")
  }
  if (legacyApplicable &&
      compareDecimal({ left: legacyAverageCost, right: "0" }) <= 0) {
    throw new RangeError("legacyAverageCost must be positive when legacy base is debited")
  }

  const recoveryNetProfit = subtractDecimal({
    left: recoveryNetQuoteProceeds,
    right: recoveryCostBasis,
  })
  const recoveryEligible = compareDecimal({
    left: recoveryNetProfit,
    right: minProfit,
  }) >= 0

  const legacyCostBasis = legacyApplicable
    ? multiplyDecimal({
      left: legacyAverageCost,
      right: legacyBaseDebit,
    })
    : "0"
  const legacyNetProfit = subtractDecimal({
    left: legacyNetQuoteProceeds,
    right: legacyCostBasis,
  })
  const legacyEligible = !legacyApplicable || compareDecimal({
    left: legacyNetProfit,
    right: "0",
  }) >= 0

  return Object.freeze({
    recovery: Object.freeze({
      costBasis: recoveryCostBasis,
      netQuoteProceeds: recoveryNetQuoteProceeds,
      netProfit: recoveryNetProfit,
      minProfit,
      eligible: recoveryEligible,
    }),
    legacy: Object.freeze({
      applicable: legacyApplicable,
      averageCost: legacyAverageCost,
      baseDebit: legacyBaseDebit,
      costBasis: legacyCostBasis,
      netQuoteProceeds: legacyNetQuoteProceeds,
      netProfit: legacyNetProfit,
      eligible: legacyEligible,
    }),
    eligible: recoveryEligible && legacyEligible,
  })
}
