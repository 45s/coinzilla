import test from "node:test"
import assert from "node:assert/strict"
import {
  applyRecoverySellerStopGate,
  createRecoverySellerStopDecision,
  createRecoverySellerStopState,
  latchRecoverySellerStop,
  resolveRecoverySellerStopState,
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


test("clears STOP only after an explicit operator action and complete reconciliation/accounting evidence", () => {
  const stoppedState = latchRecoverySellerStop({
    state: createRecoverySellerStopState(),
    decision: createRecoverySellerStopDecision({
      explanation: "The exchange order outcome required operator review",
    }),
  })
  const resolved = resolveRecoverySellerStopState({
    state: stoppedState,
    operatorId: "operator-45s",
    actionId: "rs-stop-reset-1",
    causeFixed: true,
    reconciliation: {
      ordersReconciled: true,
      fillsReconciled: true,
      balancesReconciled: true,
      unresolvedOrderCount: 0,
      unresolvedFillCount: 0,
      balanceDiscrepancyCount: 0,
    },
    accounting: {
      verified: true,
      portfolioConsistent: true,
      legacyConsistent: true,
      reservationsConsistent: true,
    },
  })

  assert.deepEqual(resolved, {
    status: "CLEAR",
    decision: null,
  }, "Only an explicit, evidence-backed operator resolution may return RS to CLEAR.")
  assert.equal(Object.isFrozen(resolved), true, "The resolved STOP state must remain immutable.")
})

test("refuses STOP reset when the cause, orders, fills, balances, or accounting remain unresolved", () => {
  const stoppedState = latchRecoverySellerStop({
    state: createRecoverySellerStopState(),
    decision: createRecoverySellerStopDecision({
      explanation: "The order fill set is incomplete",
    }),
  })
  const valid = {
    state: stoppedState,
    operatorId: "operator-45s",
    actionId: "rs-stop-reset-2",
    causeFixed: true,
    reconciliation: {
      ordersReconciled: true,
      fillsReconciled: true,
      balancesReconciled: true,
      unresolvedOrderCount: 0,
      unresolvedFillCount: 0,
      balanceDiscrepancyCount: 0,
    },
    accounting: {
      verified: true,
      portfolioConsistent: true,
      legacyConsistent: true,
      reservationsConsistent: true,
    },
  }

  assert.throws(
    () => resolveRecoverySellerStopState({
      ...valid,
      causeFixed: false,
    }),
    /underlying cause must be fixed/i,
  )
  assert.throws(
    () => resolveRecoverySellerStopState({
      ...valid,
      reconciliation: {
        ...valid.reconciliation,
        unresolvedOrderCount: 1,
      },
    }),
    /unresolved orders/i,
  )
  assert.throws(
    () => resolveRecoverySellerStopState({
      ...valid,
      reconciliation: {
        ...valid.reconciliation,
        unresolvedFillCount: 1,
      },
    }),
    /unresolved fills/i,
  )
  assert.throws(
    () => resolveRecoverySellerStopState({
      ...valid,
      reconciliation: {
        ...valid.reconciliation,
        balanceDiscrepancyCount: 1,
      },
    }),
    /balance discrepancies/i,
  )
  assert.throws(
    () => resolveRecoverySellerStopState({
      ...valid,
      accounting: {
        ...valid.accounting,
        verified: false,
      },
    }),
    /accounting must be verified/i,
  )
})

test("does not clear a STOP state that is already clear or malformed", () => {
  assert.throws(
    () => resolveRecoverySellerStopState({
      state: createRecoverySellerStopState(),
      operatorId: "operator-45s",
      actionId: "rs-stop-reset-3",
      causeFixed: true,
      reconciliation: {},
      accounting: {},
    }),
    /only a stopped Recovery Seller state/i,
  )
})
