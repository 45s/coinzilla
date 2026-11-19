import test from "node:test"
import assert from "node:assert/strict"
import {
  createRecoverySellerCycleState,
  recordRecoverySellerCycleSellSubmission,
} from "./cycle-state.js"
import { createRecoverySellerLifecycleDecision } from "./lifecycle-decision.js"
import {
  applyRecoverySellerStopGate,
  createRecoverySellerStopState,
} from "./stop-decision.js"
import {
  reconcileRecoverySellerCycleSellWithStop,
  recordRecoverySellerCycleSellUnknown,
  startNextRecoverySellerCycleWithStop,
} from "./lifecycle-state.js"

function submittedCycle() {
  return recordRecoverySellerCycleSellSubmission({
    state: createRecoverySellerCycleState({
      cycleId: "rs-cycle-1",
      positionId: "rs-position-1",
    }),
    orderIdentity: {
      clientOrderId: "rs-sell-1",
    },
  })
}

test("latches global STOP and preserves the original SELL identity for an unknown submission", () => {
  const result = recordRecoverySellerCycleSellUnknown({
    stopState: createRecoverySellerStopState(),
    cycleState: submittedCycle(),
    explanation: "SELL submission acknowledgement is unknown",
  })

  assert.equal(result.stopState.status, "STOPPED",
    "An unknown SELL submission must latch global STOP.")
  assert.equal(result.cycleState.status, "RECONCILIATION_REQUIRED",
    "The cycle must remain blocked pending authoritative SELL reconciliation.")
  assert.equal(result.decision.outcome, "RECONCILE",
    "Only non-trading reconciliation may continue for the unknown SELL.")
  assert.deepEqual(result.decision.orderIdentity, {
    clientOrderId: "rs-sell-1",
  }, "Reconciliation must retain the original client order identity.")
})

test("preserves the first STOP evidence when an unknown SELL is observed again", () => {
  const first = recordRecoverySellerCycleSellUnknown({
    stopState: createRecoverySellerStopState(),
    cycleState: submittedCycle(),
    explanation: "First unknown SELL acknowledgement",
  })
  const second = recordRecoverySellerCycleSellUnknown({
    stopState: first.stopState,
    cycleState: first.cycleState,
    explanation: "Later repeated unknown SELL observation",
  })

  assert.equal(second.stopState, first.stopState,
    "A later STOP observation must not replace the first STOP latch.")
  assert.equal(second.stopDecision, first.stopDecision,
    "The original operator-review evidence must remain authoritative.")
  assert.equal(second.cycleState, first.cycleState,
    "Repeated unknown observations must not mutate the original cycle identity.")
})

test("continues terminal fill reconciliation while STOP remains active", () => {
  const stopped = recordRecoverySellerCycleSellUnknown({
    stopState: createRecoverySellerStopState(),
    cycleState: submittedCycle(),
    explanation: "SELL submission acknowledgement is unknown",
  })
  const reconciled = reconcileRecoverySellerCycleSellWithStop({
    stopState: stopped.stopState,
    cycleState: stopped.cycleState,
    orderIdentity: {
      clientOrderId: "rs-sell-1",
    },
    terminalOrderStatus: "FILLED",
    reconciliationComplete: true,
    profitabilityEligible: true,
  })

  assert.equal(reconciled.cycleState.status, "CLOSED",
    "Authoritative terminal fill and accounting reconciliation must continue under STOP.")
  assert.equal(reconciled.stopState, stopped.stopState,
    "Fill reconciliation must not clear or replace the sticky STOP latch.")
  assert.equal(reconciled.stopState.status, "STOPPED")
})

test("does not clear STOP when creating a new cycle after a successful prior cycle", () => {
  const stopped = recordRecoverySellerCycleSellUnknown({
    stopState: createRecoverySellerStopState(),
    cycleState: submittedCycle(),
    explanation: "SELL submission acknowledgement is unknown",
  })
  const reconciled = reconcileRecoverySellerCycleSellWithStop({
    stopState: stopped.stopState,
    cycleState: stopped.cycleState,
    orderIdentity: {
      clientOrderId: "rs-sell-1",
    },
    terminalOrderStatus: "FILLED",
    reconciliationComplete: true,
    profitabilityEligible: true,
  })
  const next = startNextRecoverySellerCycleWithStop({
    stopState: reconciled.stopState,
    previousState: reconciled.cycleState,
    nextCycleId: "rs-cycle-2",
  })
  const submit = createRecoverySellerLifecycleDecision({
    outcome: "SUBMIT",
    reasonCode: "TEST_SUBMIT",
    explanation: "A candidate order in the next cycle",
  })
  const gated = applyRecoverySellerStopGate({
    stopState: next.stopState,
    decision: submit,
  })

  assert.equal(next.cycleState.positionId, "rs-position-1",
    "A new cycle must retain its stable recovery Position identity unless explicitly replaced.")
  assert.equal(next.cycleState.cycleId, "rs-cycle-2")
  assert.equal(next.cycleState.status, "ACCUMULATING")
  assert.equal(next.stopState, stopped.stopState,
    "Starting a new cycle must not implicitly clear a prior STOP.")
  assert.equal(gated.stopState, stopped.stopState)
  assert.equal(gated.decision, stopped.stopDecision,
    "The sticky STOP must still block a new-cycle SUBMIT.")
})
