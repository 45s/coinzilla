import assert from "node:assert/strict"
import test from "node:test"
import { createRecoverySellerStopRuntime } from "./create-recovery-seller-stop-runtime.js"

function createMemoryOperationalStateStore() {
  const records = []
  return {
    records,
    append: async (fact) => {
      records.push(fact)
      return {
        ok: true,
        data: {
          durable: true,
          record: fact,
        },
      }
    },
    readAll: async () => ({
      ok: true,
      data: {
        records: [...records],
      },
    }),
  }
}

test("does not require durable STOP storage when no RS routes are configured", async () => {
  const result = await createRecoverySellerStopRuntime({
    recoverySellerPairs: {},
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.enabled, false)
  assert.equal(result.data.workflow, undefined)
})

test("rejects configured RS routes without an Operational State Store", async () => {
  const result = await createRecoverySellerStopRuntime({
    recoverySellerPairs: {
      ZROUSDT: {},
    },
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /require an Operational State Store for durable STOP/)
})

test("composes a durable STOP workflow for configured RS routes", async () => {
  const operationalStateStore = createMemoryOperationalStateStore()
  const result = await createRecoverySellerStopRuntime({
    recoverySellerPairs: {
      ZROUSDT: {},
    },
    operationalStateStore,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.enabled, true)
  assert.equal(typeof result.data.workflow.latch, "function")
  assert.equal(typeof result.data.workflow.resolve, "function")
  const stopped = await result.data.workflow.latch({
    explanation: "RS runtime startup integration test",
  })

  assert.equal(stopped.ok, true)
  assert.equal(result.data.workflow.getStopState().status, "STOPPED")
  assert.equal(operationalStateStore.records.length, 1)
  assert.equal(operationalStateStore.records[0].factType, "SAFETY_BLOCKER_RAISED")
})
