import test from "node:test"
import assert from "node:assert/strict"
import {
  applyRecoverySellerLifecycleTransition,
  createRecoverySellerLifecycleDecision,
} from "./lifecycle-decision.js"
import {
  createRecoverySellerStopDecision,
  createRecoverySellerStopState,
  latchRecoverySellerStop,
  RECOVERY_SELLER_STOP_REASON_CODE,
} from "./stop-decision.js"

function makeDecision({ outcome, reasonCode = `TEST_${outcome}`, orderIdentity } = {}) {
  return createRecoverySellerLifecycleDecision({
    outcome,
    reasonCode,
    explanation: `Test lifecycle decision for ${outcome}`,
    ...(orderIdentity === undefined ? {} : { orderIdentity }),
  })
}

test("creates distinct immutable SUBMIT, WAIT, BLOCK and RECONCILE decisions", () => {
  const submit = makeDecision({ outcome: "SUBMIT" })
  const wait = makeDecision({
    outcome: "WAIT",
    orderIdentity: { clientOrderId: "h-existing-order", brokerOrderId: "exchange-123" },
  })
  const block = makeDecision({ outcome: "BLOCK" })
  const reconcile = makeDecision({
    outcome: "RECONCILE",
    orderIdentity: { clientOrderId: "h-unknown-submit" },
  })

  assert.equal(submit.outcome, "SUBMIT", "SUBMIT must represent permission to hand one new approved order intent to the shared engine.")
  assert.equal(wait.outcome, "WAIT", "WAIT must represent an already-known active order that remains untouched pending its next authoritative update.")
  assert.equal(block.outcome, "BLOCK", "BLOCK must represent a deterministic refusal to initiate a trading action.")
  assert.equal(reconcile.outcome, "RECONCILE", "RECONCILE must represent non-trading resolution of an existing order whose authoritative outcome is not yet known.")
  assert.deepEqual(wait.orderIdentity, {
    clientOrderId: "h-existing-order",
    brokerOrderId: "exchange-123",
  }, "WAIT must retain both identities for an acknowledged existing order.")
  assert.deepEqual(reconcile.orderIdentity, {
    clientOrderId: "h-unknown-submit",
  }, "RECONCILE must retain the client identity even when the broker acknowledgement identity is unknown.")
  assert.equal(Object.isFrozen(submit), true, "Lifecycle decisions must be immutable values.")
  assert.equal(Object.isFrozen(wait.orderIdentity), true, "Existing-order identity must be immutable while waiting.")
})

test("rejects unsupported outcomes, missing reason codes and incomplete order identities", () => {
  assert.throws(
    () => createRecoverySellerLifecycleDecision({
      outcome: "CANCEL",
      reasonCode: "UNAPPROVED_CANCEL",
      explanation: "Cancellation is not an approved lifecycle outcome",
    }),
    /outcome must be one of SUBMIT, WAIT, BLOCK, RECONCILE/,
    "An unsupported action must not be represented as a lifecycle outcome.",
  )
  assert.throws(
    () => createRecoverySellerLifecycleDecision({
      outcome: "SUBMIT",
      reasonCode: " ",
      explanation: "Missing reason code",
    }),
    /reasonCode must be a non-empty string/,
    "Every lifecycle outcome must expose a stable non-empty reason code.",
  )
  assert.throws(
    () => createRecoverySellerLifecycleDecision({
      outcome: "WAIT",
      reasonCode: "WAIT_EXISTING",
      explanation: "The broker identity is missing",
      orderIdentity: { clientOrderId: "h-existing-order" },
    }),
    /WAIT requires clientOrderId and brokerOrderId/,
    "WAIT must identify an acknowledged active order rather than an unknown submission.",
  )
  assert.throws(
    () => createRecoverySellerLifecycleDecision({
      outcome: "RECONCILE",
      reasonCode: "RECONCILE_UNKNOWN",
      explanation: "The client identity is missing",
      orderIdentity: {},
    }),
    /RECONCILE requires clientOrderId/,
    "RECONCILE must preserve the original client order identity before attempting non-trading reconciliation.",
  )
})

test("allows only the documented transitions within one recovery cycle", () => {
  const validTransitions = [
    ["SUBMIT", "WAIT"],
    ["SUBMIT", "RECONCILE"],
    ["SUBMIT", "BLOCK"],
    ["WAIT", "WAIT"],
    ["WAIT", "RECONCILE"],
    ["WAIT", "BLOCK"],
    ["RECONCILE", "RECONCILE"],
    ["RECONCILE", "WAIT"],
    ["RECONCILE", "BLOCK"],
    ["BLOCK", "BLOCK"],
    ["BLOCK", "WAIT"],
    ["BLOCK", "RECONCILE"],
  ]

  for (const [previousOutcome, nextOutcome] of validTransitions) {
    const previousDecision = makeDecision({
      outcome: previousOutcome,
      ...(previousOutcome === "WAIT" ? { orderIdentity: { clientOrderId: "h-order", brokerOrderId: "exchange-123" } } : {}),
      ...(previousOutcome === "RECONCILE" ? { orderIdentity: { clientOrderId: "h-order" } } : {}),
    })
    const nextDecision = makeDecision({
      outcome: nextOutcome,
      ...(nextOutcome === "WAIT" ? { orderIdentity: { clientOrderId: "h-order", brokerOrderId: "exchange-123" } } : {}),
      ...(nextOutcome === "RECONCILE" ? { orderIdentity: { clientOrderId: "h-order" } } : {}),
    })
    const result = applyRecoverySellerLifecycleTransition({
      stopState: createRecoverySellerStopState(),
      previousDecision,
      nextDecision,
    })

    assert.equal(result.decision, nextDecision, `The ${previousOutcome} → ${nextOutcome} transition must preserve its approved lifecycle decision.`)
    assert.equal(result.stopState.status, "CLEAR", `The approved ${previousOutcome} → ${nextOutcome} transition must not create an unrelated global STOP.`)
  }
})

test("allows a new initial SUBMIT but never a direct resubmission within an existing cycle", () => {
  const initialSubmit = makeDecision({ outcome: "SUBMIT" })
  const initialResult = applyRecoverySellerLifecycleTransition({
    stopState: createRecoverySellerStopState(),
    nextDecision: initialSubmit,
  })
  const previousSubmit = makeDecision({ outcome: "SUBMIT" })
  const repeatedSubmit = makeDecision({ outcome: "SUBMIT" })
  const repeatedResult = applyRecoverySellerLifecycleTransition({
    stopState: createRecoverySellerStopState(),
    previousDecision: previousSubmit,
    nextDecision: repeatedSubmit,
  })

  assert.equal(initialResult.decision, initialSubmit, "A new cycle with no previous lifecycle outcome may submit only after its separate policy gates pass.")
  assert.equal(repeatedResult.decision.outcome, "BLOCK", "A second SUBMIT inside the same cycle must be blocked instead of duplicating an order.")
  assert.equal(repeatedResult.decision.reasonCode, RECOVERY_SELLER_STOP_REASON_CODE, "An unsupported repeated submission must establish the stable global STOP reason.")
  assert.equal(repeatedResult.stopState.status, "STOPPED", "An unsupported repeated submission must latch STOP for the remainder of the unresolved cycle.")
})

test("turns an unsupported transition back to SUBMIT into sticky global STOP", () => {
  const previousDecision = makeDecision({
    outcome: "WAIT",
    orderIdentity: { clientOrderId: "h-existing-order", brokerOrderId: "exchange-123" },
  })
  const nextDecision = makeDecision({ outcome: "SUBMIT" })
  const result = applyRecoverySellerLifecycleTransition({
    stopState: createRecoverySellerStopState(),
    previousDecision,
    nextDecision,
  })

  assert.equal(result.decision.outcome, "BLOCK", "A WAIT lifecycle must not transition directly into a new trading submission.")
  assert.equal(result.decision.reasonCode, RECOVERY_SELLER_STOP_REASON_CODE, "An unsupported transition must use the stable global STOP reason code.")
  assert.equal(result.stopState.status, "STOPPED", "An unsupported lifecycle transition must latch STOP rather than silently starting another order.")
})

test("keeps a latched STOP active while permitting only WAIT or RECONCILE transitions", () => {
  const stopDecision = createRecoverySellerStopDecision({
    explanation: "The exchange returned an unmodeled order status",
  })
  const stoppedState = latchRecoverySellerStop({
    state: createRecoverySellerStopState(),
    decision: stopDecision,
  })
  const waitDecision = makeDecision({
    outcome: "WAIT",
    orderIdentity: { clientOrderId: "h-existing-order", brokerOrderId: "exchange-123" },
  })
  const reconcileDecision = makeDecision({
    outcome: "RECONCILE",
    orderIdentity: { clientOrderId: "h-unknown-submit" },
  })
  const submitDecision = makeDecision({ outcome: "SUBMIT" })
  const waitResult = applyRecoverySellerLifecycleTransition({
    stopState: stoppedState,
    previousDecision: makeDecision({ outcome: "BLOCK" }),
    nextDecision: waitDecision,
  })
  const reconcileResult = applyRecoverySellerLifecycleTransition({
    stopState: stoppedState,
    previousDecision: makeDecision({ outcome: "BLOCK" }),
    nextDecision: reconcileDecision,
  })
  const submitResult = applyRecoverySellerLifecycleTransition({
    stopState: stoppedState,
    previousDecision: makeDecision({ outcome: "BLOCK" }),
    nextDecision: submitDecision,
  })

  assert.equal(waitResult.decision, waitDecision, "Waiting for an existing acknowledged order must remain available during global STOP.")
  assert.equal(reconcileResult.decision, reconcileDecision, "Reconciling an existing unknown order outcome must remain available during global STOP.")
  assert.equal(submitResult.decision, stopDecision, "A latched STOP must reject every new trading submission, even if the candidate decision is otherwise eligible.")
  assert.equal(submitResult.stopState, stoppedState, "A blocked submission must not clear or replace the existing STOP state.")
})
