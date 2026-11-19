import test from "node:test"
import assert from "node:assert/strict"
import {
  applyRecoverySellerStopGate,
  createRecoverySellerStopDecision,
  createRecoverySellerStopState,
  latchRecoverySellerStop,
  RECOVERY_SELLER_STOP_REASON_CODE,
} from "./stop-decision.js"

test("starts with a clear immutable STOP state before any unexpected condition", () => {
  const state = createRecoverySellerStopState()

  assert.deepEqual(state, {
    status: "CLEAR",
    decision: null,
  }, "A new RS policy state must begin clear and contain no fabricated STOP decision.")
  assert.equal(Object.isFrozen(state), true, "The STOP state must be immutable so callers cannot clear or alter it in place.")
})

test("latches the first owner-approved STOP decision as immutable lifecycle state", () => {
  const decision = createRecoverySellerStopDecision({
    explanation: "Exchange order status is not covered by the approved lifecycle",
  })
  const state = latchRecoverySellerStop({
    state: createRecoverySellerStopState(),
    decision,
  })

  assert.deepEqual(state, {
    status: "STOPPED",
    decision,
  }, "An unexpected RS condition must latch its deterministic BLOCK decision into lifecycle state.")
  assert.equal(state.decision.reasonCode, RECOVERY_SELLER_STOP_REASON_CODE, "The latched STOP must preserve the stable global reason code.")
  assert.equal(Object.isFrozen(state), true, "The latched STOP state must be immutable.")
})

test("does not resume or submit after STOP when a later decision appears normal", () => {
  const originalDecision = createRecoverySellerStopDecision({
    explanation: "Verified Spot quantity disagrees with the accounting projection",
  })
  const stoppedState = latchRecoverySellerStop({
    state: createRecoverySellerStopState(),
    decision: originalDecision,
  })
  const result = applyRecoverySellerStopGate({
    stopState: stoppedState,
    decision: {
      outcome: "SUBMIT",
      reasonCode: "BUY_ELIGIBLE",
      action: {
        side: "BUY",
      },
    },
  })

  assert.equal(result.stopState, stoppedState, "A later normal observation must not replace or clear the existing STOP state.")
  assert.equal(result.decision, originalDecision, "The global gate must reject a new trading action and retain the original STOP evidence.")
  assert.equal(result.decision.blocksNewTradingActions, true, "No BUY, SELL, retry, replacement, or other new trading action may pass a latched STOP.")
})

test("allows only waiting and reconciliation while a sticky STOP is active", () => {
  const originalDecision = createRecoverySellerStopDecision({
    explanation: "An existing order has an unknown exchange outcome",
  })
  const stoppedState = latchRecoverySellerStop({
    state: createRecoverySellerStopState(),
    decision: originalDecision,
  })
  const waitResult = applyRecoverySellerStopGate({
    stopState: stoppedState,
    decision: {
      outcome: "WAIT",
      reasonCode: "WAIT_FOR_EXISTING_ORDER",
    },
  })
  const reconcileResult = applyRecoverySellerStopGate({
    stopState: stoppedState,
    decision: {
      outcome: "RECONCILE",
      reasonCode: "RECONCILE_EXISTING_ORDER",
    },
  })

  assert.equal(waitResult.decision.outcome, "WAIT", "A known existing order may remain untouched while the STOP blocks new trading.")
  assert.equal(reconcileResult.decision.outcome, "RECONCILE", "Non-trading reconciliation of an existing order must remain possible during STOP.")
  assert.equal(waitResult.stopState, stoppedState, "Waiting must not clear the sticky STOP state.")
  assert.equal(reconcileResult.stopState, stoppedState, "Reconciliation must not clear the sticky STOP state.")
})

test("retains the first STOP reason when another unexpected condition is observed", () => {
  const firstDecision = createRecoverySellerStopDecision({
    explanation: "The first unexpected condition requires operator review",
  })
  const secondDecision = createRecoverySellerStopDecision({
    explanation: "A second unexpected condition occurred during reconciliation",
  })
  const firstState = latchRecoverySellerStop({
    state: createRecoverySellerStopState(),
    decision: firstDecision,
  })
  const nextState = latchRecoverySellerStop({
    state: firstState,
    decision: secondDecision,
  })

  assert.equal(nextState, firstState, "A subsequent STOP must not overwrite the first latched evidence or silently reset lifecycle state.")
  assert.equal(nextState.decision.explanation, firstDecision.explanation, "The first actionable STOP explanation must remain available for operator review.")
})

test("turns missing or unsupported lifecycle decisions into a sticky STOP", () => {
  const initialState = createRecoverySellerStopState()
  const missingDecision = applyRecoverySellerStopGate({
    stopState: initialState,
  })
  const unsupportedDecision = applyRecoverySellerStopGate({
    stopState: initialState,
    decision: {
      outcome: "CANCEL",
      reasonCode: "UNAPPROVED_CANCEL",
    },
  })

  assert.equal(missingDecision.decision.outcome, "BLOCK", "A missing RS policy decision must fail closed instead of allowing an implicit action.")
  assert.equal(missingDecision.decision.reasonCode, RECOVERY_SELLER_STOP_REASON_CODE, "A missing policy decision must use the stable global STOP reason code.")
  assert.equal(missingDecision.stopState.status, "STOPPED", "A missing policy decision must latch STOP so a later normal input cannot resume trading.")
  assert.equal(unsupportedDecision.decision.outcome, "BLOCK", "An unsupported lifecycle outcome must fail closed instead of being treated as permission to trade.")
  assert.equal(unsupportedDecision.stopState.status, "STOPPED", "An unsupported lifecycle outcome must establish sticky STOP state.")
})

test("rejects attempts to latch a non-STOP decision or an invalid state", () => {
  assert.throws(
    () => latchRecoverySellerStop({
      state: createRecoverySellerStopState(),
      decision: {
        outcome: "SUBMIT",
        reasonCode: "BUY_ELIGIBLE",
      },
    }),
    /requires a sticky global STOP decision/,
    "The STOP latch must not accept an ordinary submission decision as STOP evidence.",
  )
  assert.throws(
    () => applyRecoverySellerStopGate({
      stopState: {
        status: "CLEAR",
        decision: {},
      },
      decision: {
        outcome: "SUBMIT",
        reasonCode: "BUY_ELIGIBLE",
      },
    }),
    /requires a valid STOP state/,
    "Malformed lifecycle state must not be accepted as permission to submit an RS trading action.",
  )
})
