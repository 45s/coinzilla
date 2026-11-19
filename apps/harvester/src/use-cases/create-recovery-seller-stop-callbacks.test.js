import assert from "node:assert/strict"
import test from "node:test"
import { createRecoverySellerStopCallbacks } from "./create-recovery-seller-stop-callbacks.js"

function createStopWorkflow() {
  let stopState = Object.freeze({
    status: "CLEAR",
    decision: null,
  })
  const latchCalls = []
  return {
    latchCalls,
    workflow: {
      getStopState: () => stopState,
      latch: async (input) => {
        latchCalls.push(input)
        stopState = Object.freeze({
          status: "STOPPED",
          decision: Object.freeze({
            explanation: input.explanation,
          }),
        })
        return {
          ok: true,
          data: {
            durable: true,
          },
        }
      },
    },
  }
}

test("allows submission only while the durable RS STOP workflow is clear", () => {
  const { workflow } = createStopWorkflow()
  const callbacks = createRecoverySellerStopCallbacks({
    stopWorkflow: workflow,
  })

  assert.equal(callbacks.canSubmit(), true)
})

test("latches durable STOP with the original client and broker order identity", async () => {
  const { workflow, latchCalls } = createStopWorkflow()
  const callbacks = createRecoverySellerStopCallbacks({
    stopWorkflow: workflow,
  })

  const result = await callbacks.onUnresolvedSubmission({
    order: {
      side: "SELL",
      clientOrderId: "h-rs-sell-1",
      brokerOrderId: "broker-rs-sell-1",
    },
    outcome: "UNKNOWN",
    error: new Error("sensitive provider diagnostic"),
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.durable, true)
  assert.equal(callbacks.canSubmit(), false)
  assert.deepEqual(latchCalls[0].orderIdentity, {
    clientOrderId: "h-rs-sell-1",
    brokerOrderId: "broker-rs-sell-1",
  })
  assert.match(latchCalls[0].explanation, /SELL submission outcome UNKNOWN/)
  assert.equal(latchCalls[0].explanation.includes("sensitive provider diagnostic"), false)
})

test("fails closed when an unresolved submission has no original client order id", async () => {
  const { workflow } = createStopWorkflow()
  const callbacks = createRecoverySellerStopCallbacks({
    stopWorkflow: workflow,
  })

  await assert.rejects(
    callbacks.onUnresolvedSubmission({
      order: {
        side: "BUY",
      },
      outcome: "UNKNOWN",
    }),
    /requires the original clientOrderId/,
  )
})

test("latches STOP for local order validation failures", async () => {
  const { workflow, latchCalls } = createStopWorkflow()
  const callbacks = createRecoverySellerStopCallbacks({
    stopWorkflow: workflow,
  })

  const result = await callbacks.onOrderValidationFailure({
    order: {
      side: "BUY",
      clientOrderId: "h-rs-buy-1",
    },
  })

  assert.equal(result.data.durable, true)
  assert.equal(callbacks.canSubmit(), false)
  assert.equal(latchCalls[0].orderIdentity.clientOrderId, "h-rs-buy-1")
})
