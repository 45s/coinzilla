/**
 * Stable lifecycle outcomes shared by the pure Recovery Seller policy.
 */
export const RECOVERY_SELLER_LIFECYCLE_OUTCOMES = Object.freeze({
  SUBMIT: "SUBMIT",
  WAIT: "WAIT",
  BLOCK: "BLOCK",
  RECONCILE: "RECONCILE",
})

/**
 * Stable reason for a condition outside the explicitly approved RS scenarios.
 */
export const RECOVERY_SELLER_STOP_REASON_CODE = "UNEXPECTED_OR_UNMODELED_CONDITION"

const NON_TRADING_STOP_OUTCOMES = new Set([
  RECOVERY_SELLER_LIFECYCLE_OUTCOMES.WAIT,
  RECOVERY_SELLER_LIFECYCLE_OUTCOMES.RECONCILE,
])

const VALID_OUTCOMES = new Set(Object.values(RECOVERY_SELLER_LIFECYCLE_OUTCOMES))

/**
 * Build the fail-closed decision for an RS condition outside the approved
 * domain scenarios. Callers must latch this decision before evaluating any
 * later trading action.
 *
 * @param {object} input
 * @param {string} input.explanation Safe diagnostic explanation for operator review.
 * @returns {object} Immutable global STOP decision.
 */
export function createRecoverySellerStopDecision({ explanation } = {}) {
  if (typeof explanation !== "string" || explanation.trim().length === 0) {
    throw new TypeError("explanation must be a non-empty string")
  }

  return Object.freeze({
    outcome: RECOVERY_SELLER_LIFECYCLE_OUTCOMES.BLOCK,
    reasonCode: RECOVERY_SELLER_STOP_REASON_CODE,
    explanation: explanation.trim(),
    blocksNewTradingActions: true,
    reconciliationRequired: true,
    operatorReviewRequired: true,
    sticky: true,
  })
}

/**
 * Create the initial immutable RS STOP latch.
 *
 * There is intentionally no automatic clear operation. A future clear path
 * requires a separately approved and evidenced resolution contract.
 *
 * @returns {{ status: "CLEAR", decision: null }} Initial lifecycle STOP state.
 */
export function createRecoverySellerStopState() {
  return Object.freeze({
    status: "CLEAR",
    decision: null,
  })
}

function isValidStopDecision(decision) {
  return Boolean(
    decision &&
    typeof decision === "object" &&
    !Array.isArray(decision) &&
    decision.outcome === RECOVERY_SELLER_LIFECYCLE_OUTCOMES.BLOCK &&
    decision.reasonCode === RECOVERY_SELLER_STOP_REASON_CODE &&
    typeof decision.explanation === "string" &&
    decision.explanation.trim().length > 0 &&
    decision.blocksNewTradingActions === true &&
    decision.reconciliationRequired === true &&
    decision.operatorReviewRequired === true &&
    decision.sticky === true
  )
}

function assertStopState({ state } = {}) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("Recovery Seller STOP gate requires a valid STOP state")
  }
  if (state.status === "CLEAR" && state.decision === null) {
    return
  }
  if (state.status === "STOPPED" && isValidStopDecision(state.decision)) {
    return
  }
  throw new TypeError("Recovery Seller STOP gate requires a valid STOP state")
}

function isValidLifecycleDecision(decision) {
  return Boolean(
    decision &&
    typeof decision === "object" &&
    !Array.isArray(decision) &&
    VALID_OUTCOMES.has(decision.outcome) &&
    typeof decision.reasonCode === "string" &&
    decision.reasonCode.trim().length > 0
  )
}

/**
 * Latch the first global STOP decision. Subsequent STOP observations cannot
 * replace its evidence or return the lifecycle to a clear state.
 *
 * @param {object} input
 * @param {object} input.state Current immutable STOP state.
 * @param {object} input.decision Output of createRecoverySellerStopDecision().
 * @returns {object} Immutable STOP state.
 */
export function latchRecoverySellerStop({ state, decision } = {}) {
  assertStopState({ state })
  if (state.status === "STOPPED") {
    return state
  }
  if (!isValidStopDecision(decision)) {
    throw new TypeError("Recovery Seller STOP latch requires a sticky global STOP decision")
  }
  return Object.freeze({
    status: "STOPPED",
    decision,
  })
}

/**
 * Apply the global STOP gate to one lifecycle decision.
 *
 * While STOP is active, only WAIT and RECONCILE may proceed because neither
 * initiates a new trading action. SUBMIT, BLOCK, missing decisions and
 * unsupported outcomes retain the original STOP decision. An invalid or
 * missing decision while clear creates and latches a global STOP.
 *
 * @param {object} input
 * @param {object} input.stopState Current immutable STOP state.
 * @param {object} [input.decision] Candidate pure lifecycle decision.
 * @returns {{ stopState: object, decision: object }} Immutable gated result.
 */
export function applyRecoverySellerStopGate({ stopState, decision } = {}) {
  assertStopState({
    state: stopState,
  })

  if (stopState.status === "STOPPED") {
    if (isValidLifecycleDecision(decision) && NON_TRADING_STOP_OUTCOMES.has(decision.outcome)) {
      return Object.freeze({
        stopState,
        decision,
      })
    }
    return Object.freeze({
      stopState,
      decision: stopState.decision,
    })
  }

  if (!isValidLifecycleDecision(decision) ||
      (decision.reasonCode === RECOVERY_SELLER_STOP_REASON_CODE && !isValidStopDecision(decision))) {
    const stopDecision = createRecoverySellerStopDecision({
      explanation: "Recovery Seller policy produced a missing, invalid, or unsupported lifecycle decision",
    })
    const nextStopState = latchRecoverySellerStop({
      state: stopState,
      decision: stopDecision,
    })
    return Object.freeze({
      stopState: nextStopState,
      decision: stopDecision,
    })
  }

  if (isValidStopDecision(decision)) {
    const nextStopState = latchRecoverySellerStop({
      state: stopState,
      decision,
    })
    return Object.freeze({
      stopState: nextStopState,
      decision,
    })
  }

  return Object.freeze({
    stopState,
    decision,
  })
}
