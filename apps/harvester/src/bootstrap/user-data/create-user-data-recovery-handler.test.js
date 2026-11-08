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
  assert.equal(
    fixture.calls.ownershipReconciled,
    false,
    "A stale recovery generation must not certify canonical ownership after its reconciliation promise resolves.",
  )
  assert.equal(fixture.calls.acknowledgements, 0, "A stale recovery generation must never be acknowledged.")
})

test("does not certify canonical ownership when accounting fails during owned-order reconciliation", async () => {
  let resolveReconciliation
  const reconciliation = new Promise((resolve) => { resolveReconciliation = resolve })
  const fixture = createRecovery({ reconcileOwnedOrders: () => reconciliation })
  fixture.start()
  fixture.state.accountingFailed = true
  resolveReconciliation({ ok: true, data: { reconciled: 2 } })
  await fixture.state.recoveryTask

  assert.equal(
    fixture.state.ready,
    false,
    "An accounting failure during owned-order reconciliation must never reopen the Harvester trading-readiness gate.",
  )
  assert.equal(
    fixture.state.requiresReconciliation,
    true,
    "An accounting failure during owned-order reconciliation must preserve the application reconciliation requirement.",
  )
  assert.equal(
    fixture.calls.ownershipReconciled,
    false,
    "Canonical ownership must not be certified when accounting became unsafe during the reconciliation operation.",
  )
  assert.equal(
    fixture.calls.accountAudits.length,
    0,
    "Account snapshot auditing must not begin after accounting fails during owned-order reconciliation.",
  )
  assert.equal(
    fixture.calls.orderAudits.length,
    0,
    "Open-orders auditing must not begin after accounting fails during owned-order reconciliation.",
  )
  assert.equal(
    fixture.calls.acknowledgements,
    0,
    "The broker must not be acknowledged after accounting fails during owned-order reconciliation.",
  )
  assert.equal(
    fixture.state.recoveryTask,
    null,
    "An accounting failure during owned-order reconciliation must release the in-flight task slot.",
  )
  assert.equal(
    fixture.logs.error[0]?.errorMessage,
    "User-data accounting failed during recovery",
    "The accounting failure during owned-order reconciliation must remain visible in the recovery diagnostic.",
  )
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
  let reconciliationCalls = 0
  const fixture = createRecovery({
    reconcileOwnedOrders: () => {
      reconciliationCalls += 1
      return reconciliation
    },
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
    fixture.state.recoveryTask,
    inFlightRecovery,
    "A repeated reminder must retain the original in-flight recovery task instead of replacing it with a duplicate.",
  )
  assert.equal(
    reconciliationCalls,
    1,
    "A repeated reminder while reconciliation is in flight must not start a second owned-order reconciliation.",
  )
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
    reconciliationCalls,
    1,
    "The same recovery generation must perform owned-order reconciliation exactly once despite repeated reminders.",
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

test("keeps recovery blocked when the canonical account balance snapshot cannot be loaded", async () => {
  let openOrderReads = 0
  const fixture = createRecovery({
    refreshAccountSnapshot: async () => {
      throw new Error("canonical account balance snapshot unavailable")
    },
    getOpenOrders: async () => {
      openOrderReads += 1
      return { ok: true, data: [] }
    },
  })
  fixture.start()
  await fixture.state.recoveryTask

  assert.equal(
    fixture.state.ready,
    false,
    "A failed canonical account balance read must never reopen the Harvester trading-readiness gate.",
  )
  assert.equal(
    fixture.state.requiresReconciliation,
    true,
    "A failed canonical account balance read must preserve the application reconciliation requirement.",
  )
  assert.equal(
    fixture.state.status,
    "AUTHORITATIVE_RECONCILIATION_REQUIRED",
    "A failed canonical account balance read must retain the explicit reconciliation-blocked status.",
  )
  assert.equal(
    openOrderReads,
    0,
    "The account-wide open-orders request must not run after the prerequisite account balance snapshot fails.",
  )
  assert.equal(
    fixture.calls.accountAudits.length,
    0,
    "A recovery account audit must not be published without a canonical account balance snapshot.",
  )
  assert.equal(
    fixture.calls.orderAudits.length,
    0,
    "A recovery open-orders audit must not be published when the account balance snapshot is unavailable.",
  )
  assert.equal(
    fixture.calls.acknowledgements,
    0,
    "The broker must not be acknowledged when the canonical account balance snapshot cannot be loaded.",
  )
  assert.equal(
    fixture.state.recoveryTask,
    null,
    "A failed canonical account balance read must release the in-flight task slot for a later retry.",
  )
  assert.equal(
    fixture.logs.error[0]?.errorMessage,
    "canonical account balance snapshot unavailable",
    "The canonical account balance read failure must remain visible in the recovery diagnostic.",
  )
})

test("keeps recovery blocked when the durable account open-orders audit fails", async () => {
  const fixture = createRecovery({
    publishOpenOrdersSnapshot: async () => {
      throw new Error("durable account open-orders audit flush failed")
    },
  })
  fixture.start()
  await fixture.state.recoveryTask

  assert.equal(
    fixture.state.ready,
    false,
    "A failed durable account open-orders audit must never reopen the Harvester trading-readiness gate.",
  )
  assert.equal(
    fixture.state.requiresReconciliation,
    true,
    "A failed durable account open-orders audit must preserve the application reconciliation requirement.",
  )
  assert.equal(
    fixture.state.status,
    "AUTHORITATIVE_RECONCILIATION_REQUIRED",
    "A failed durable account open-orders audit must retain the explicit reconciliation-blocked status.",
  )
  assert.equal(
    fixture.calls.accountAudits.length,
    1,
    "The successful account snapshot audit may remain durable, but it cannot substitute for the failed open-orders audit.",
  )
  assert.equal(
    fixture.calls.orderAudits.length,
    1,
    "The open-orders audit attempt must be recorded before its durability failure is handled.",
  )
  assert.equal(
    fixture.calls.acknowledgements,
    0,
    "The broker must not be acknowledged when the durable account open-orders audit fails.",
  )
  assert.equal(
    fixture.state.recoveryTask,
    null,
    "A failed durable account open-orders audit must release the in-flight task slot for a later retry.",
  )
  assert.equal(
    fixture.logs.error[0]?.errorMessage,
    "durable account open-orders audit flush failed",
    "The durable account open-orders audit failure must remain visible in the recovery diagnostic.",
  )
})

test("does not publish the open-orders audit after recovery is superseded during the account audit", async () => {
  let fixture
  fixture = createRecovery({
    publishAccountSnapshot: async () => {
      fixture.state.recoveryGeneration += 1
    },
  })
  fixture.start()
  await fixture.state.recoveryTask

  assert.equal(
    fixture.state.ready,
    false,
    "A recovery generation superseded during the account audit must never reopen the Harvester trading-readiness gate.",
  )
  assert.equal(
    fixture.state.requiresReconciliation,
    true,
    "A recovery generation superseded during the account audit must preserve the application reconciliation requirement.",
  )
  assert.equal(
    fixture.calls.accountAudits.length,
    1,
    "The account audit already in progress may finish, but it must not authorize the next recovery stage.",
  )
  assert.equal(
    fixture.calls.orderAudits.length,
    0,
    "The open-orders audit must not begin after the recovery generation becomes stale during the account audit.",
  )
  assert.equal(
    fixture.calls.acknowledgements,
    0,
    "A superseded recovery generation must never acknowledge the broker after its account audit.",
  )
  assert.equal(
    fixture.state.recoveryTask,
    null,
    "A superseded recovery generation must release the in-flight task slot after the stale audit is detected.",
  )
  assert.equal(
    fixture.logs.error[0]?.errorMessage,
    "User-data recovery generation was superseded",
    "The superseded recovery generation must leave an actionable failure diagnostic.",
  )
})

test("repeats the recovery snapshots without publishing stale open orders when an event arrives during the account audit", async () => {
  let fixture
  let accountAuditAttempts = 0
  let openOrderReads = 0
  fixture = createRecovery({
    getOpenOrders: async () => {
      openOrderReads += 1
      return { ok: true, data: [] }
    },
    publishAccountSnapshot: async () => {
      accountAuditAttempts += 1
      if (accountAuditAttempts === 1) {
        fixture.state.eventSequence += 1
      }
    },
  })
  fixture.start()
  await fixture.state.recoveryTask

  assert.equal(
    accountAuditAttempts,
    2,
    "A user-data event during the account audit must force a fresh account snapshot audit for a stable recovery window.",
  )
  assert.equal(
    openOrderReads,
    2,
    "The account-wide open-orders REST request must be repeated after the account audit observes an intervening user-data event.",
  )
  assert.equal(
    fixture.calls.orderAudits.length,
    1,
    "Only the open-orders snapshot from the stable post-event recovery window may be published.",
  )
  assert.equal(
    fixture.calls.acknowledgements,
    1,
    "Recovery may be acknowledged only after the account and open-orders audits describe a stable event window.",
  )
})

test("does not drain queued user-data events after recovery is superseded during the open-orders audit", async () => {
  let fixture
  fixture = createRecovery({
    publishOpenOrdersSnapshot: async () => {
      fixture.state.recoveryGeneration += 1
    },
  })
  fixture.start()
  await fixture.state.recoveryTask

  assert.equal(
    fixture.state.ready,
    false,
    "A recovery generation superseded during the open-orders audit must never reopen the Harvester trading-readiness gate.",
  )
  assert.equal(
    fixture.state.requiresReconciliation,
    true,
    "A recovery generation superseded during the open-orders audit must preserve the application reconciliation requirement.",
  )
  assert.equal(
    fixture.calls.accountAudits.length,
    1,
    "The account snapshot audit must already have completed before the open-orders stage is invalidated.",
  )
  assert.equal(
    fixture.calls.orderAudits.length,
    1,
    "The in-flight open-orders audit may finish, but it must not authorize any later recovery work.",
  )
  assert.equal(
    fixture.calls.drains,
    3,
    "A superseded generation must be detected before the old recovery task drains additional user-data events.",
  )
  assert.equal(
    fixture.calls.acknowledgements,
    0,
    "A superseded recovery generation must never acknowledge the broker after the open-orders audit.",
  )
  assert.equal(
    fixture.state.recoveryTask,
    null,
    "A superseded recovery generation must release the in-flight task slot after the audit completes.",
  )
  assert.equal(
    fixture.logs.error[0]?.errorMessage,
    "User-data recovery generation was superseded",
    "The superseded recovery generation must leave an actionable failure diagnostic.",
  )
})

test("recovers safely when a second disconnect supersedes a later retry", async () => {
  let resolveSecondReconciliation
  const secondReconciliation = new Promise((resolve) => { resolveSecondReconciliation = resolve })
  let reconciliationCalls = 0
  const fixture = createRecovery({
    reconcileOwnedOrders: async () => {
      reconciliationCalls += 1
      if (reconciliationCalls === 1) {
        return {
          ok: false,
          errors: [new Error("temporary owned-order history failure")],
        }
      }
      if (reconciliationCalls === 2) return secondReconciliation
      return { ok: true, data: { reconciled: 2 } }
    },
  })

  fixture.start()
  const firstAttempt = fixture.state.recoveryTask
  await firstAttempt

  assert.equal(
    fixture.state.recoveryTask,
    null,
    "A failed first attempt must release its task slot so a broker reminder can retry the same generation.",
  )
  assert.equal(
    fixture.calls.acknowledgements,
    0,
    "A failed first attempt must not acknowledge the broker.",
  )

  fixture.start()
  const secondAttempt = fixture.state.recoveryTask

  assert.notEqual(
    secondAttempt,
    null,
    "A later recovered reminder must start a retry after the first attempt has failed.",
  )
  assert.equal(
    reconciliationCalls,
    2,
    "The retry must begin a new owned-order reconciliation after the prior task has released its slot.",
  )

  fixture.state.recoveryGeneration = 2
  resolveSecondReconciliation({ ok: true, data: { reconciled: 2 } })
  await secondAttempt

  assert.equal(
    fixture.calls.ownershipReconciled,
    false,
    "The second disconnect must prevent the superseded retry from certifying canonical ownership.",
  )
  assert.equal(
    fixture.calls.acknowledgements,
    0,
    "The superseded retry must not acknowledge either the old or new recovery generation.",
  )
  assert.equal(
    fixture.state.requiresReconciliation,
    true,
    "A second disconnect during retry must leave application reconciliation required.",
  )
  assert.equal(
    fixture.state.recoveryTask,
    null,
    "The superseded retry must release its task slot so the new generation can recover.",
  )

  fixture.start()
  await fixture.state.recoveryTask

  assert.equal(
    reconciliationCalls,
    3,
    "The new generation must start its own owned-order reconciliation after the stale retry exits.",
  )
  assert.equal(
    fixture.calls.ownershipReconciled,
    true,
    "Only the current recovery generation may certify canonical ownership.",
  )
  assert.equal(
    fixture.calls.accountAudits.length,
    1,
    "Only the current recovery generation may publish the recovery account audit.",
  )
  assert.equal(
    fixture.calls.orderAudits.length,
    1,
    "Only the current recovery generation may publish the recovery open-orders audit.",
  )
  assert.equal(
    fixture.calls.acknowledgements,
    1,
    "Only the current recovery generation may acknowledge the broker.",
  )
  assert.equal(
    fixture.state.lastAcknowledgedRecoveryGeneration,
    2,
    "The final acknowledgement must be recorded against the latest recovery generation.",
  )
  assert.equal(
    fixture.state.requiresReconciliation,
    false,
    "Successful reconciliation of the latest generation must clear the application reconciliation requirement.",
  )
})
