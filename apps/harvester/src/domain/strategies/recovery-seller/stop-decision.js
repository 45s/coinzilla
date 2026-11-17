/**
 * Build the fail-closed decision for an RS condition outside the approved
 * domain scenarios. This is a pure policy value; callers must not submit a
 * trading action from this decision.
 */
export const RECOVERY_SELLER_STOP_REASON_CODE = "UNEXPECTED_OR_UNMODELED_CONDITION"

export function createRecoverySellerStopDecision({ explanation } = {}) {
  if (typeof explanation !== "string" || explanation.trim().length === 0) {
    throw new TypeError("explanation must be a non-empty string")
  }

  return Object.freeze({
    outcome: "BLOCK",
    reasonCode: RECOVERY_SELLER_STOP_REASON_CODE,
    explanation: explanation.trim(),
    blocksNewTradingActions: true,
    reconciliationRequired: true,
    operatorReviewRequired: true,
    sticky: true,
  })
}
