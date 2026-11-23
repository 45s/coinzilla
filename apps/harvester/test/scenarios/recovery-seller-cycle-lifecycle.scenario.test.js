import test from "node:test"
import assert from "node:assert/strict"
import {
  createRecoverySellerCycleState,
  markRecoverySellerCycleSellUnknown,
  reconcileRecoverySellerCycleSell,
  recordRecoverySellerCycleSellSubmission,
  startNextRecoverySellerCycle,
} from "../../src/domain/strategies/recovery-seller/cycle-state.js"

const initialOrderIdentity = {
  clientOrderId: "rs-lifecycle-cycle-001-sell",
}

function createSubmittedCycle() {
  return recordRecoverySellerCycleSellSubmission({
    state: createRecoverySellerCycleState({
      cycleId: "rs-lifecycle-cycle-001",
      positionId: "rs-lifecycle-position-001",
    }),
    orderIdentity: initialOrderIdentity,
  })
}

function assertNextCycleBlocked({ state, nextCycleId }) {
  assert.throws(
    () => startNextRecoverySellerCycle({
      previousState: state,
      nextCycleId,
    }),
    /only from a closed profitable and reconciled cycle/,
    "A cycle without a closed, profitable and reconciled SELL must not advance.",
  )
}

function assertClosedCycleCanAdvance({ state, nextCycleId }) {
  const nextCycle = startNextRecoverySellerCycle({
    previousState: state,
    nextCycleId,
  })
  assert.equal(nextCycle.status, "ACCUMULATING",
    "A new cycle may start only after the original SELL is confirmed, reconciled and profitable.")
}

test("an unknown SELL outcome retains its only identity until reconciliation completes", () => {
  const submitted = createSubmittedCycle()
  const unknown = markRecoverySellerCycleSellUnknown({ state: submitted })

  assert.equal(unknown.status, "RECONCILIATION_REQUIRED",
    "An ambiguous submission outcome must move the cycle into reconciliation-required state.")
  assert.equal(unknown.sellOrderIdentity.clientOrderId, initialOrderIdentity.clientOrderId,
    "The original client order identity must remain attached to the cycle.")
  assert.strictEqual(markRecoverySellerCycleSellUnknown({ state: unknown }), unknown,
    "Repeated unknown-outcome notification must be an exact no-op.")
  assert.throws(
    () => recordRecoverySellerCycleSellSubmission({
      state: unknown,
      orderIdentity: {
        clientOrderId: "rs-lifecycle-cycle-001-replacement",
      },
    }),
    /only one SELL order lifecycle/,
    "An unknown submission outcome must never authorize a blind replacement SELL.",
  )

  const incomplete = reconcileRecoverySellerCycleSell({
    state: unknown,
    orderIdentity: initialOrderIdentity,
    terminalOrderStatus: "FILLED",
    reconciliationComplete: false,
    profitabilityEligible: null,
  })
  assert.equal(incomplete.status, "RECONCILIATION_REQUIRED",
    "A terminal status without complete canonical fill/accounting reconciliation must not close the cycle.")
  assert.equal(incomplete.terminalReconciled, false,
    "The cycle must record that terminal reconciliation remains incomplete.")
  assert.equal(incomplete.profitabilityEligible, null,
    "Profitability must remain unevaluated until complete reconciliation is available.")
  assertNextCycleBlocked({
    state: incomplete,
    nextCycleId: "rs-lifecycle-cycle-002",
  })

  const reconciled = reconcileRecoverySellerCycleSell({
    state: incomplete,
    orderIdentity: {
      clientOrderId: initialOrderIdentity.clientOrderId,
      brokerOrderId: "binance-order-001",
    },
    terminalOrderStatus: "FILLED",
    reconciliationComplete: true,
    profitabilityEligible: true,
  })
  assert.equal(reconciled.status, "CLOSED",
    "The original SELL may close the cycle only after complete reconciliation and passing profitability.")
  assert.equal(reconciled.sellOrderIdentity.brokerOrderId, "binance-order-001",
    "Reconciliation may enrich the original identity with its confirmed broker order ID.")
  assertClosedCycleCanAdvance({
    state: reconciled,
    nextCycleId: "rs-lifecycle-cycle-002",
  })
})

for (const terminalOrderStatus of ["CANCELED", "REJECTED", "EXPIRED"]) {
  test(`a terminal ${terminalOrderStatus.toLowerCase()} SELL remains unresolved and forbids replacement`, () => {
    const submitted = createSubmittedCycle()
    const unresolved = reconcileRecoverySellerCycleSell({
      state: submitted,
      orderIdentity: initialOrderIdentity,
      terminalOrderStatus,
      reconciliationComplete: true,
      profitabilityEligible: false,
    })

    assert.equal(unresolved.status, "UNRESOLVED",
      "A non-FILLED terminal SELL must not close a recovery cycle.")
    assert.equal(unresolved.terminalOrderStatus, terminalOrderStatus,
      "The exact terminal broker outcome must remain visible on the unresolved cycle.")
    assert.equal(unresolved.terminalReconciled, true,
      "The terminal order outcome must be reconciled before the cycle becomes unresolved.")
    assert.throws(
      () => recordRecoverySellerCycleSellSubmission({
        state: unresolved,
        orderIdentity: {
          clientOrderId: "rs-lifecycle-cycle-001-replacement",
        },
      }),
      /only one SELL order lifecycle/,
      "A terminal unsuccessful SELL must not be replaced by another SELL in the same cycle.",
    )
    assert.throws(
      () => startNextRecoverySellerCycle({
        previousState: unresolved,
        nextCycleId: "rs-lifecycle-cycle-002",
      }),
      /only from a closed profitable and reconciled cycle/,
      "A terminal unsuccessful SELL must not permit a new recovery cycle.",
    )
  })
}

test("a terminal SELL with a different client identity cannot reconcile the submitted cycle", () => {
  const submitted = createSubmittedCycle()

  assert.throws(
    () => reconcileRecoverySellerCycleSell({
      state: submitted,
      orderIdentity: {
        clientOrderId: "rs-lifecycle-unrelated-sell",
      },
      terminalOrderStatus: "FILLED",
      reconciliationComplete: true,
      profitabilityEligible: true,
    }),
    /Terminal order identity does not match the cycle SELL identity/,
    "A terminal event for another order must not close or mutate this cycle.",
  )
  assert.equal(submitted.status, "SELL_SUBMITTED",
    "Rejecting a conflicting terminal identity must preserve the submitted cycle state.")
  assert.equal(submitted.sellOrderIdentity.clientOrderId, initialOrderIdentity.clientOrderId,
    "The original SELL identity must remain unchanged after a conflicting terminal event.")
})
