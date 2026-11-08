import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createAccountIntegritySafetyHalt } from "./create-account-integrity-safety-halt.js"

const test = (name, ...args) => nodeTest("[create-account-integrity-safety-halt.test.js] " + name, ...args)

test("reconciles owned order identities before cancelling BUYs", async () => {
  const calls = []
  const cancel = createAccountIntegritySafetyHalt({
    getTradingEngine: () => ({
      reconcileOwnedOrders: async () => { calls.push("reconcile"); return { ok: true } },
      cancelOwnedBuyOrdersForSafetyHalt: async () => { calls.push("cancel-owned-buys"); return { ok: true } },
    }),
    logger: {},
  })

  await cancel()

  assert.deepEqual(calls, ["reconcile", "cancel-owned-buys"], "Safety halt must resolve broker ownership before selecting BUY orders for cancellation.")
})

test("shares concurrent safety-halt work and skips execution after stop", async () => {
  const calls = []
  let releaseReconciliation
  const reconciliationGate = new Promise((resolve) => { releaseReconciliation = resolve })
  let signalReconciliation
  const reconciliationStarted = new Promise((resolve) => { signalReconciliation = resolve })
  const cancel = createAccountIntegritySafetyHalt({
    getTradingEngine: () => ({
      reconcileOwnedOrders: async () => {
        calls.push("reconcile")
        signalReconciliation()
        await reconciliationGate
        return { ok: true }
      },
      cancelOwnedBuyOrdersForSafetyHalt: async () => { calls.push("cancel-owned-buys"); return { ok: true } },
    }),
    logger: {},
  })

  const first = cancel()
  const second = cancel()
  await reconciliationStarted
  assert.deepEqual(calls, ["reconcile"], "Concurrent safety-halt triggers must share the reconciliation task.")

  releaseReconciliation()
  await Promise.all([first, second])
  assert.deepEqual(calls, ["reconcile", "cancel-owned-buys"], "The shared workflow must cancel once after reconciliation.")

  let stopped = true
  const stoppedCancel = createAccountIntegritySafetyHalt({
    getTradingEngine: () => ({ reconcileOwnedOrders: async () => { throw new Error("must not run") } }),
    isStopped: () => stopped,
    logger: {},
  })
  await stoppedCancel()
  stopped = false
})

test("logs reconciliation and cancellation failures without skipping the safety attempt", async () => {
  const logs = []
  const cancel = createAccountIntegritySafetyHalt({
    getTradingEngine: () => ({
      reconcileOwnedOrders: async () => ({ ok: false, errors: [new Error("reconcile failed")] }),
      cancelOwnedBuyOrdersForSafetyHalt: async () => { throw new Error("cancel failed") },
    }),
    logger: { error: (entry) => logs.push(entry.message) },
  })

  await cancel()

  assert.deepEqual(logs, [
    "account-integrity safety halt could not fully reconcile owned orders before BUY cancellation",
    "account-integrity safety halt failed while canceling owned BUY orders",
  ], "Safety-halt failures must remain observable and cancellation must still be attempted after reconciliation failure.")
})
