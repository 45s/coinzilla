import assert from "node:assert/strict"
import test from "node:test"
import { initializeHarvesterDurableFactsLedger } from "./initialize-durable-facts-ledger.js"

test("requires explicit confirmation before acquiring locks or creating a ledger", async () => {
  let lockCalls = 0
  let storeCalls = 0
  const result = await initializeHarvesterDurableFactsLedger({
    confirmed: false,
    acquireProcessLock: async () => { lockCalls += 1; return { ok: true, release: async () => ({ ok: true }) } },
    createStore: () => { storeCalls += 1; return { initialize: async () => ({ ok: true, data: { durable: true } }) } },
  })
  assert.equal(result.ok, false, "Genesis creation must require an explicit operator confirmation.")
  assert.equal(lockCalls, 0, "Unconfirmed initialization must not acquire process locks.")
  assert.equal(storeCalls, 0, "Unconfirmed initialization must not create a store.")
})

test("creates genesis only while holding the broker-wide and Journal process locks", async () => {
  const sequence = []
  let storeInput
  const result = await initializeHarvesterDurableFactsLedger({
    confirmed: true,
    directory: "/tmp/recovery-facts",
    processLockDirectory: "/tmp/process-locks",
    runtimeSessionId: "initializer-session",
    acquireProcessLock: async (input) => {
      sequence.push("lock")
      assert.equal(input.journalDirectory, "/tmp/process-locks")
      assert.equal(input.globalDirectory, "/tmp/process-locks")
      assert.equal(input.broker, "binance")
      return { ok: true, release: async () => { sequence.push("release"); return { ok: true } } }
    },
    createStore: (input) => {
      storeInput = input
      return { initialize: async () => {
        sequence.push("initialize")
        return { ok: true, data: { durable: true, record: { sequence: "0", digest: "a".repeat(64) } } }
      } }
    },
  })
  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual(sequence, ["lock", "initialize", "release"], "Genesis must be committed under the same process locks used by runtime startup.")
  assert.deepEqual(storeInput, { directory: "/tmp/recovery-facts", runtimeSessionId: "initializer-session" })
  assert.equal(result.data.sequence, "0")
  assert.equal(result.data.durable, true)
})

test("does not claim successful initialization when the store refuses to overwrite an existing ledger", async () => {
  let released = false
  const result = await initializeHarvesterDurableFactsLedger({
    confirmed: true,
    acquireProcessLock: async () => ({ ok: true, release: async () => { released = true; return { ok: true } } }),
    createStore: () => ({ initialize: async () => ({ ok: false, errors: [new Error("refuses to overwrite existing ledger")] }) }),
  })
  assert.equal(result.ok, false, "An existing ledger must never be overwritten.")
  assert.equal(released, true, "The process lock must be released after a refused initialization.")
})


test("does not claim genesis success if the process lock cannot be released", async () => {
  const result = await initializeHarvesterDurableFactsLedger({
    confirmed: true,
    acquireProcessLock: async () => ({
      ok: true,
      release: async () => ({ ok: false, errors: [new Error("lock release failed")] }),
    }),
    createStore: () => ({
      initialize: async () => ({ ok: true, data: { durable: true, record: { sequence: "0", digest: "a".repeat(64) } } }),
    }),
  })
  assert.equal(result.ok, false, "A committed genesis must not be reported as fully initialized while the exclusive process lock remains uncertain.")
})
