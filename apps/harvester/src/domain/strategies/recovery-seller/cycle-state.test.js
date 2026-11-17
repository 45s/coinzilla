import test from "node:test"
import assert from "node:assert/strict"
import {
  createRecoverySellerCycleState,
  markRecoverySellerCycleSellUnknown,
  recordRecoverySellerCycleSellSubmission,
  reconcileRecoverySellerCycleSell,
  startNextRecoverySellerCycle,
} from "./cycle-state.js"

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

test("creates an immutable accumulating cycle before its single SELL is submitted", () => {
  const state = createRecoverySellerCycleState({
    cycleId: "rs-cycle-1",
    positionId: "rs-position-1",
  })

  assert.deepEqual(state, {
    cycleId: "rs-cycle-1",
    positionId: "rs-position-1",
    status: "ACCUMULATING",
    sellOrderIdentity: null,
    terminalOrderStatus: null,
    terminalReconciled: false,
    profitabilityEligible: null,
  }, "A new cycle must begin in BUY accumulation with no SELL order or fabricated terminal evidence.")
  assert.equal(Object.isFrozen(state), true,
    "Cycle state must be immutable.")
})

test("allows exactly one SELL submission in a recovery cycle", () => {
  const state = submittedCycle()

  assert.equal(state.status, "SELL_SUBMITTED",
    "The first SELL intent must reserve the single SELL lifecycle for this cycle.")
  assert.deepEqual(state.sellOrderIdentity, {
    clientOrderId: "rs-sell-1",
  }, "The cycle must retain the original client order identity.")
  assert.throws(
    () => recordRecoverySellerCycleSellSubmission({
      state,
      orderIdentity: {
        clientOrderId: "rs-sell-2",
      },
    }),
    /only one SELL order lifecycle/,
    "A second SELL in the same recovery cycle must be rejected.",
  )
})

test("retains the original SELL identity when submission acknowledgement is unknown", () => {
  const submitted = submittedCycle()
  const unresolved = markRecoverySellerCycleSellUnknown({
    state: submitted,
  })

  assert.equal(unresolved.status, "RECONCILIATION_REQUIRED",
    "An unknown submission result must keep the cycle blocked pending reconciliation.")
  assert.deepEqual(unresolved.sellOrderIdentity, submitted.sellOrderIdentity,
    "Unknown submission must retain the original order identity and must not create a replacement.")
  assert.equal(unresolved.terminalReconciled, false,
    "Unknown submission is not terminal reconciliation evidence.")
})

test("closes a cycle only after a fully reconciled FILLED SELL passes cycle profitability", () => {
  const state = reconcileRecoverySellerCycleSell({
    state: submittedCycle(),
    orderIdentity: {
      clientOrderId: "rs-sell-1",
    },
    terminalOrderStatus: "FILLED",
    reconciliationComplete: true,
    profitabilityEligible: true,
  })

  assert.equal(state.status, "CLOSED",
    "A cycle may close only after the sole SELL is fully filled, completely reconciled and profitable.")
  assert.equal(state.terminalReconciled, true,
    "The closed cycle must retain complete reconciliation evidence.")
  assert.equal(state.profitabilityEligible, true,
    "The closed cycle must retain the successful combined cycle profitability result.")
})

test("keeps a terminal partial, canceled, rejected or expired SELL unresolved", () => {
  for (const terminalOrderStatus of ["CANCELED", "REJECTED", "EXPIRED"]) {
    const state = reconcileRecoverySellerCycleSell({
      state: submittedCycle(),
      orderIdentity: {
        clientOrderId: "rs-sell-1",
      },
      terminalOrderStatus,
      reconciliationComplete: true,
      profitabilityEligible: false,
    })

    assert.equal(state.status, "UNRESOLVED",
      `A terminal ${terminalOrderStatus} SELL must not authorize a second SELL or a new BUY cycle.`)
    assert.equal(state.terminalReconciled, true,
      "Terminal order/fill reconciliation may be complete even though the recovery cycle remains unresolved.")
  }

  const partial = reconcileRecoverySellerCycleSell({
    state: submittedCycle(),
    orderIdentity: {
      clientOrderId: "rs-sell-1",
    },
    terminalOrderStatus: "CANCELED",
    reconciliationComplete: true,
    profitabilityEligible: true,
  })
  assert.equal(partial.status, "UNRESOLVED",
    "A canceled SELL with partial execution must remain unresolved even if the realized proceeds appear profitable.")
})

test("keeps a FILLED SELL unresolved when realized cycle profitability fails", () => {
  const state = reconcileRecoverySellerCycleSell({
    state: submittedCycle(),
    orderIdentity: {
      clientOrderId: "rs-sell-1",
    },
    terminalOrderStatus: "FILLED",
    reconciliationComplete: true,
    profitabilityEligible: false,
  })

  assert.equal(state.status, "UNRESOLVED",
    "The unresolved post-fill loss policy must fail closed instead of inventing a recovery action.")
  assert.equal(state.profitabilityEligible, false,
    "The adverse realized result must remain explicit.")
})

test("retains the cycle in reconciliation when terminal fill history is incomplete", () => {
  const state = reconcileRecoverySellerCycleSell({
    state: submittedCycle(),
    orderIdentity: {
      clientOrderId: "rs-sell-1",
    },
    terminalOrderStatus: "FILLED",
    reconciliationComplete: false,
    profitabilityEligible: null,
  })

  assert.equal(state.status, "RECONCILIATION_REQUIRED",
    "A broker-terminal order is not a completed cycle until all canonical fills and accounting projections reconcile.")
  assert.equal(state.terminalReconciled, false,
    "Incomplete fill history must not be recorded as reconciled.")
})

test("starts a new recovery cycle only from a closed, profitable and reconciled prior cycle", () => {
  const closed = reconcileRecoverySellerCycleSell({
    state: submittedCycle(),
    orderIdentity: {
      clientOrderId: "rs-sell-1",
    },
    terminalOrderStatus: "FILLED",
    reconciliationComplete: true,
    profitabilityEligible: true,
  })
  const next = startNextRecoverySellerCycle({
    previousState: closed,
    nextCycleId: "rs-cycle-2",
  })

  assert.equal(next.positionId, "rs-position-1",
    "A next cycle must retain the stable recovery Position unless a new Position identity is explicitly supplied.")
  assert.equal(next.cycleId, "rs-cycle-2",
    "A new cycle must have a distinct stable identity.")
  assert.equal(next.status, "ACCUMULATING",
    "A new BUY accumulation cycle may start only after the previous cycle closed successfully.")
  assert.throws(
    () => startNextRecoverySellerCycle({
      previousState: reconcileRecoverySellerCycleSell({
        state: submittedCycle(),
        orderIdentity: {
          clientOrderId: "rs-sell-1",
        },
        terminalOrderStatus: "CANCELED",
        reconciliationComplete: true,
        profitabilityEligible: false,
      }),
      nextCycleId: "rs-cycle-2",
    }),
    /only from a closed profitable and reconciled cycle/,
    "A canceled/partial SELL must not be reset into a new cycle.",
  )
})

test("rejects mismatched order identity and incomplete terminal evidence", () => {
  assert.throws(
    () => reconcileRecoverySellerCycleSell({
      state: submittedCycle(),
      orderIdentity: {
        clientOrderId: "another-order",
      },
      terminalOrderStatus: "FILLED",
      reconciliationComplete: true,
      profitabilityEligible: true,
    }),
    /does not match the cycle SELL identity/,
    "A different order must never close the cycle.")
  assert.throws(
    () => reconcileRecoverySellerCycleSell({
      state: submittedCycle(),
      orderIdentity: {
        clientOrderId: "rs-sell-1",
      },
      terminalOrderStatus: "PARTIALLY_FILLED",
      reconciliationComplete: true,
      profitabilityEligible: false,
    }),
    /terminalOrderStatus must be one of FILLED, CANCELED, REJECTED, EXPIRED/,
    "A non-terminal order status must not be accepted as terminal reconciliation evidence.")
})


test("requires a stable Position identity for every recovery cycle", () => {
  assert.throws(
    () => createRecoverySellerCycleState({
      cycleId: "rs-cycle-missing-position",
      positionId: "",
    }),
    /positionId must be a non-empty string/,
    "A cycle without a stable Position identity must not be created.",
  )
})
