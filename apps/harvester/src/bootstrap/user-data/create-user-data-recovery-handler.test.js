import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createUserDataRecoveryHandler } from "./create-user-data-recovery-handler.js"

const test = (name, ...args) => nodeTest("[create-user-data-recovery-handler.test.js] " + name, ...args)

const createState = (overrides = {}) => ({
  ready: false,
  requiresReconciliation: true,
  accountingFailed: false,
  status: "AUTHORITATIVE_RECONCILIATION_REQUIRED",
  eventSequence: 0,
  recoveryGeneration: 1,
  lastAcknowledgedRecoveryGeneration: 0,
  recoveryTask: null,
  startupComplete: true,
  pendingRecovery: false,
  ...overrides,
})

const createRecovery = ({ state = createState(), reconcileOwnedOrders, getOpenOrders, refreshAccountSnapshot, publishAccountSnapshot, publishOpenOrdersSnapshot, acknowledgeRecovery, drainUserDataEvents, setCanonicalOwnershipReconciled } = {}) => {
  const calls = { acknowledgements: 0, accountAudits: [], orderAudits: [], drains: 0, ownershipReconciled: false }
  const userDataSubscription = {
    acknowledgeRecovery: () => {
      calls.acknowledgements += 1
      return acknowledgeRecovery ? acknowledgeRecovery() : true
    },
  }
  const broker = {
    getOpenOrders: async () => getOpenOrders ? getOpenOrders(calls, state) : ({ ok: true, data: [] }),
  }
  const start = createUserDataRecoveryHandler({
    state,
    isStopped: () => false,
    getUserDataSubscription: () => userDataSubscription,
    getTradingEngine: () => ({ reconcileOwnedOrders: reconcileOwnedOrders ?? (async () => ({ ok: true, data: { reconciled: 2 } })) }),
    tradingEnabled: true,
    broker,
    drainUserDataEvents: async () => {
      calls.drains += 1
      if (drainUserDataEvents) await drainUserDataEvents(calls, state)
    },
    setCanonicalOwnershipReconciled: (value) => {
      calls.ownershipReconciled = value
      setCanonicalOwnershipReconciled?.(value)
    },
    refreshAccountSnapshot: async () => refreshAccountSnapshot ? refreshAccountSnapshot(calls) : ({ sourceTime: 100 }),
    publishAccountSnapshot: async (input) => {
      calls.accountAudits.push(input)
      if (publishAccountSnapshot) await publishAccountSnapshot(input, calls)
    },
    publishOpenOrdersSnapshot: async (input) => {
      calls.orderAudits.push(input)
      if (publishOpenOrdersSnapshot) await publishOpenOrdersSnapshot(input, calls)
    },
    logger: { info: () => {}, error: () => {} },
  })
  return { start, state, calls }
}

test("waits for user-data startup completion before beginning recovery", () => {
  const state = createState({ startupComplete: false })
  const fixture = createRecovery({ state })
  fixture.start()

  assert.equal(state.pendingRecovery, true, "An early recovery request must be remembered until startup is complete.")
  assert.equal(state.recoveryTask, null, "No reconciliation task may start before the user-data startup barrier.")
  assert.equal(fixture.calls.acknowledgements, 0, "The broker must not be acknowledged before application reconciliation.")
})

test("acknowledges recovery only after owned-order reconciliation and durable account/order audits", async () => {
  const fixture = createRecovery()
  fixture.start()
  await fixture.state.recoveryTask

  assert.equal(fixture.state.requiresReconciliation, false, "Successful application recovery must clear the reconciliation gate.")
  assert.equal(fixture.state.lastAcknowledgedRecoveryGeneration, 1, "The acknowledged generation must match the recovered stream generation.")
  assert.equal(fixture.calls.ownershipReconciled, true, "Successful order reconciliation must be exposed to account-wide open-order classification.")
  assert.equal(fixture.calls.accountAudits.length, 1, "Recovery must publish the current account snapshot audit.")
  assert.equal(fixture.calls.accountAudits[0].phase, "RECOVERY", "The account snapshot must be labeled as a recovery audit.")
  assert.equal(fixture.calls.orderAudits.length, 1, "Recovery must publish the account-wide open-order audit.")
  assert.equal(fixture.calls.orderAudits[0].phase, "RECOVERY", "The open-order snapshot must be labeled as a recovery audit.")
  assert.equal(fixture.calls.acknowledgements, 1, "The broker must be acknowledged only after both audits complete.")
  assert.equal(fixture.state.recoveryTask, null, "The completed recovery task must release its in-flight slot.")
})

test("does not acknowledge a recovery generation superseded during order reconciliation", async () => {
  let resolveReconciliation
  const reconciliation = new Promise((resolve) => { resolveReconciliation = resolve })
  const fixture = createRecovery({ reconcileOwnedOrders: () => reconciliation })
  fixture.start()
  fixture.state.recoveryGeneration += 1
  resolveReconciliation({ ok: true, data: { reconciled: 2 } })
  await fixture.state.recoveryTask

  assert.equal(fixture.state.requiresReconciliation, true, "A superseded generation must remain blocked.")
  assert.equal(fixture.state.status, "AUTHORITATIVE_RECONCILIATION_REQUIRED", "A superseded generation must retain the reconciliation-required status.")
  assert.equal(fixture.calls.acknowledgements, 0, "A stale recovery generation must never be acknowledged.")
})

test("repeats REST snapshots when a user-data event arrives during the audit window", async () => {
  let openOrderReads = 0
  const fixture = createRecovery({
    getOpenOrders: async (_calls, state) => {
      openOrderReads += 1
      if (openOrderReads === 1) state.eventSequence += 1
      return { ok: true, data: [] }
    },
  })
  fixture.start()
  await fixture.state.recoveryTask

  assert.equal(openOrderReads, 2, "A user-data event during the REST audit window must force a fresh open-order read.")
  assert.equal(fixture.calls.accountAudits.length, 1, "Only the stable post-event snapshot may be durably published.")
  assert.equal(fixture.calls.acknowledgements, 1, "Recovery may be acknowledged after the repeated snapshot is stable.")
})

test("keeps recovery blocked and skips acknowledgement when durable account audit fails", async () => {
  const fixture = createRecovery({
    publishAccountSnapshot: async () => { throw new Error("journal flush failed") },
  })
  fixture.start()
  await fixture.state.recoveryTask

  assert.equal(fixture.state.requiresReconciliation, true, "A failed durable account audit must keep reconciliation required.")
  assert.equal(fixture.calls.acknowledgements, 0, "The broker must not be acknowledged after an audit failure.")
})
