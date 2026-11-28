import test from "node:test"
import assert from "node:assert/strict"
import { createUserDataRecoveryHandler } from "./create-user-data-recovery-handler.js"

test("does not run REST reconciliation when user-data recovery is disabled", () => {
  const state = {
    recoveryGeneration: 1,
    pendingRecovery: true,
    ready: false,
  }
  const warnings = []
  let dependencyCalls = 0
  const start = createUserDataRecoveryHandler({
    enabled: false,
    state,
    logger: {
      warn: (record) => warnings.push(record),
    },
    getUserDataSubscription: () => { dependencyCalls += 1 },
    broker: {
      getOpenOrders: async () => { dependencyCalls += 1 },
    },
  })

  start()
  start()
  assert.equal(dependencyCalls, 0, "Disabled user-data recovery must not read broker orders or subscriptions.")
  assert.equal(state.pendingRecovery, false, "A disabled recovery request must not remain queued.")
  assert.equal(state.ready, false, "A recovered transport must not reopen trading readiness without application reconciliation.")
  assert.equal(warnings.length, 1, "A disabled recovery generation must produce one bounded diagnostic.")

  state.recoveryGeneration += 1
  start()
  assert.equal(warnings.length, 2, "A new broker recovery generation must receive its own diagnostic.")
})
