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
  const logs = { info: [], error: [] }
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
    logger: {
      info: (entry) => { logs.info.push(entry) },
      error: (entry) => { logs.error.push(entry) },
    },
  })
  return { start, state, calls, logs }
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

test("keeps trading blocked when the broker rejects recovery acknowledgement", async () => {
  const fixture = createRecovery({
    acknowledgeRecovery: () => false,
  })
  fixture.start()
  await fixture.state.recoveryTask

  assert.equal(
    fixture.state.ready,
    false,
    "A rejected broker acknowledgement must never reopen the Harvester trading-readiness gate.",
  )
  assert.equal(
    fixture.state.requiresReconciliation,
    true,
    "A rejected broker acknowledgement must restore the application reconciliation requirement.",
  )
  assert.equal(
    fixture.state.status,
    "AUTHORITATIVE_RECONCILIATION_REQUIRED",
    "A rejected broker acknowledgement must retain the explicit reconciliation-blocked status.",
  )
  assert.equal(
    fixture.state.lastAcknowledgedRecoveryGeneration,
    0,
    "A rejected broker acknowledgement must not record the current recovery generation as acknowledged.",
  )
  assert.equal(
    fixture.calls.acknowledgements,
    1,
    "The application must make one acknowledgement attempt after the durable recovery audits complete.",
  )
  assert.equal(
    fixture.state.recoveryTask,
    null,
    "A rejected acknowledgement must release the in-flight task slot so a later reminder can retry recovery.",
  )
  assert.equal(
    fixture.logs.error[0]?.errorMessage,
    "Broker rejected the application recovery acknowledgement",
    "A rejected acknowledgement must leave an actionable application-recovery failure diagnostic.",
  )
})

test("keeps trading blocked when the broker throws during recovery acknowledgement", async () => {
  const fixture = createRecovery({
    acknowledgeRecovery: () => { throw new Error("acknowledgement transport failed") },
  })
  fixture.start()
  await fixture.state.recoveryTask

  assert.equal(
    fixture.state.ready,
    false,
    "An acknowledgement transport exception must never reopen the Harvester trading-readiness gate.",
  )
  assert.equal(
    fixture.state.requiresReconciliation,
    true,
    "An acknowledgement transport exception must preserve the application reconciliation requirement.",
  )
  assert.equal(
    fixture.state.status,
    "AUTHORITATIVE_RECONCILIATION_REQUIRED",
    "An acknowledgement transport exception must retain the explicit reconciliation-blocked status.",
  )
  assert.equal(
    fixture.state.lastAcknowledgedRecoveryGeneration,
    0,
    "An acknowledgement transport exception must not record the current recovery generation as acknowledged.",
  )
  assert.equal(
    fixture.calls.acknowledgements,
    1,
    "The application must make one acknowledgement attempt after the durable recovery audits complete.",
  )
  assert.equal(
    fixture.state.recoveryTask,
    null,
    "An acknowledgement transport exception must release the in-flight task slot for a later retry.",
  )
  assert.equal(
    fixture.logs.error[0]?.errorMessage,
    "acknowledgement transport failed",
    "The original acknowledgement exception message must remain visible in the recovery failure diagnostic.",
  )
})

test("does not mark another recovery request pending while reconciliation is already running", async () => {
  let resolveReconciliation
  const reconciliation = new Promise((resolve) => { resolveReconciliation = resolve })
  const fixture = createRecovery({
    reconcileOwnedOrders: () => reconciliation,
  })
  fixture.start()
  const inFlightRecovery = fixture.state.recoveryTask

  assert.notEqual(
    inFlightRecovery,
    null,
    "The first recovered notification must start one in-flight application reconciliation task.",
  )

  fixture.start()

  assert.equal(
    fixture.state.pendingRecovery,
    false,
    "A reminder received during an active recovery task must not be mislabeled as a pre-startup pending request.",
  )

  resolveReconciliation({ ok: true, data: { reconciled: 2 } })
  await inFlightRecovery

  assert.equal(
    fixture.state.pendingRecovery,
    false,
    "Completing the active recovery task must not leave a stale pending-recovery flag.",
  )
  assert.equal(
    fixture.calls.acknowledgements,
    1,
    "A duplicate reminder during the same in-flight generation must not create a second acknowledgement.",
  )
})

test("does not leave recovery pending when startup is complete but recovery is blocked", () => {
  const blockedStates = [
    {
      description: "accounting has failed",
      state: createState({ accountingFailed: true }),
    },
    {
      description: "the current recovery generation is already acknowledged",
      state: createState({ lastAcknowledgedRecoveryGeneration: 1 }),
    },
    {
      description: "application reconciliation is not required",
      state: createState({ requiresReconciliation: false }),
    },
  ]

  for (const blockedCase of blockedStates) {
    const fixture = createRecovery({ state: blockedCase.state })
    fixture.start()

    assert.equal(
      fixture.state.pendingRecovery,
      false,
      `A completed startup with ${blockedCase.description} must not retain a pre-startup pending-recovery request.`,
    )
    assert.equal(
      fixture.state.recoveryTask,
      null,
      `A completed startup with ${blockedCase.description} must not start an application reconciliation task.`,
    )
    assert.equal(
      fixture.calls.acknowledgements,
      0,
      `A completed startup with ${blockedCase.description} must not acknowledge a recovery generation.`,
    )
  }
})

test("keeps recovery blocked when owned-order reconciliation returns a failed result", async () => {
  const fixture = createRecovery({
    reconcileOwnedOrders: async () => ({
      ok: false,
      errors: [new Error("canonical owned-order history unavailable")],
    }),
  })
  fixture.start()
  await fixture.state.recoveryTask

  assert.equal(
    fixture.state.ready,
    false,
    "A failed owned-order reconciliation must never reopen the Harvester trading-readiness gate.",
  )
  assert.equal(
    fixture.state.requiresReconciliation,
    true,
    "A failed owned-order reconciliation must preserve the application reconciliation requirement.",
  )
  assert.equal(
    fixture.state.status,
    "AUTHORITATIVE_RECONCILIATION_REQUIRED",
    "A failed owned-order reconciliation must retain the explicit reconciliation-blocked status.",
  )
  assert.equal(
    fixture.calls.ownershipReconciled,
    false,
    "A failed owned-order reconciliation must not certify canonical ownership for account-wide order classification.",
  )
  assert.equal(
    fixture.calls.accountAudits.length,
    0,
    "Account snapshot auditing must not proceed after owned-order reconciliation fails.",
  )
  assert.equal(
    fixture.calls.orderAudits.length,
    0,
    "Account-wide open-order auditing must not proceed after owned-order reconciliation fails.",
  )
  assert.equal(
    fixture.calls.acknowledgements,
    0,
    "The broker must not be acknowledged after owned-order reconciliation fails.",
  )
  assert.equal(
    fixture.state.recoveryTask,
    null,
    "A failed owned-order reconciliation must release the in-flight task slot for a later retry.",
  )
  assert.equal(
    fixture.logs.error[0]?.errorMessage,
    "canonical owned-order history unavailable",
    "The canonical owned-order reconciliation failure must remain visible in the recovery diagnostic.",
  )
})

test("keeps recovery blocked when the account-wide open-orders REST request fails", async () => {
  const fixture = createRecovery({
    getOpenOrders: async () => ({
      ok: false,
      errors: [new Error("account-wide open-orders endpoint unavailable")],
    }),
  })
  fixture.start()
  await fixture.state.recoveryTask

  assert.equal(
    fixture.state.ready,
    false,
    "An unavailable account-wide open-orders snapshot must never reopen the Harvester trading-readiness gate.",
  )
  assert.equal(
    fixture.state.requiresReconciliation,
    true,
    "An unavailable account-wide open-orders snapshot must preserve the application reconciliation requirement.",
  )
  assert.equal(
    fixture.state.status,
    "AUTHORITATIVE_RECONCILIATION_REQUIRED",
    "An unavailable account-wide open-orders snapshot must retain the explicit reconciliation-blocked status.",
  )
  assert.equal(
    fixture.calls.ownershipReconciled,
    true,
    "The successful owned-order step may remain recorded, but it must not substitute for the missing account-wide snapshot.",
  )
  assert.equal(
    fixture.calls.accountAudits.length,
    0,
    "The recovery account audit must not be published without an authoritative account-wide open-orders snapshot.",
  )
  assert.equal(
    fixture.calls.orderAudits.length,
    0,
    "The recovery open-orders audit must not be published when the REST snapshot request fails.",
  )
  assert.equal(
    fixture.calls.acknowledgements,
    0,
    "The broker must not be acknowledged when the account-wide open-orders REST request fails.",
  )
  assert.equal(
    fixture.state.recoveryTask,
    null,
    "An account-wide open-orders REST failure must release the in-flight task slot for a later retry.",
  )
  assert.equal(
    fixture.logs.error[0]?.errorMessage,
    "Unable to load authoritative account-wide open orders: account-wide open-orders endpoint unavailable",
    "The account-wide open-orders REST failure must retain its actionable reason in the recovery diagnostic.",
  )
})
