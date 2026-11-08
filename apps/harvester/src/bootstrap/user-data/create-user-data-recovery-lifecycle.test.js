import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createUserDataRecoveryHandler } from "./create-user-data-recovery-handler.js"
import { createUserDataStatusHandler } from "./create-user-data-status-handler.js"

const test = (name, ...args) => nodeTest("[create-user-data-recovery-lifecycle.test.js] " + name, ...args)

test("a second disconnect during an in-flight recovery invalidates stale work and reconciles only the latest generation", async () => {
  const state = {
    ready: true,
    requiresReconciliation: false,
    streamUnsafe: false,
    accountingFailed: false,
    status: "READY",
    recoveryGeneration: 0,
    lastAcknowledgedRecoveryGeneration: -1,
    lastReportedRecoveredGeneration: -1,
    startupComplete: true,
    pendingRecovery: false,
    initialAccountSnapshotReady: true,
    eventSequence: 0,
    recoveryTask: null,
  }
  const logs = { info: [], error: [] }
  const accountAudits = []
  const openOrdersAudits = []
  const acknowledgements = []
  const ownershipReconciliations = []
  const observedStatuses = []
  const lifecycleEvents = []
  let reconciliationCalls = 0
  let resolveFirstReconciliation
  const firstReconciliation = new Promise((resolve) => {
    resolveFirstReconciliation = resolve
  })
  let statusHandler

  const tradingEngine = {
    reconcileOwnedOrders: async () => {
      reconciliationCalls += 1
      if (reconciliationCalls === 1) return firstReconciliation
      return { ok: true, data: { reconciled: 2, symbols: ["DOGEUSDT"] } }
    },
  }

  const subscription = {
    acknowledgeRecoveryResult: () => {
      acknowledgements.push(state.recoveryGeneration)
      statusHandler({
        type: "reconciled",
        subscriptionId: 42,
        recoveryRequired: false,
        reconciliationRequired: false,
      })
      return { accepted: true, completed: true }
    },
  }

  const startRecovery = createUserDataRecoveryHandler({
    state,
    isStopped: () => false,
    getUserDataSubscription: () => subscription,
    getTradingEngine: () => tradingEngine,
    tradingEnabled: true,
    broker: {
      getOpenOrders: async () => ({ ok: true, data: [] }),
    },
    drainUserDataEvents: async () => {},
    setCanonicalOwnershipReconciled: (value) => ownershipReconciliations.push(value),
    refreshAccountSnapshot: async () => ({ ok: true, data: { sourceTime: 100 } }),
    publishAccountSnapshot: async (input) => {
      accountAudits.push(input)
      return { ok: true }
    },
    publishOpenOrdersSnapshot: async (input) => {
      openOrdersAudits.push(input)
      return { ok: true }
    },
    logger: {
      info: (entry) => logs.info.push(entry),
      error: (entry) => logs.error.push(entry),
    },
  })

  statusHandler = createUserDataStatusHandler({
    state,
    isStopped: () => false,
    eventPublisher: {
      publish: (event) => {
        lifecycleEvents.push(event)
        return { ok: true }
      },
    },
    brokerName: "binance",
    logger: {
      info: (entry) => logs.info.push(entry),
      error: (entry) => logs.error.push(entry),
    },
    tradingEnabled: true,
    startUserDataRecovery: () => startRecovery(),
    cancelOwnedBuysAfterAccountingFailure: async () => {},
    resumeDeferredStrategyEvaluations: () => {},
    onUserDataStatus: (entry) => observedStatuses.push(entry),
  })

  statusHandler({ type: "connectionClosed", recoveryRequired: true })
  statusHandler({ type: "recovered", subscriptionId: 42, recoveryRequired: true })
  const staleTask = state.recoveryTask

  assert.equal(
    state.recoveryGeneration,
    1,
    "The first transport recovery cycle must establish generation one before application reconciliation starts.",
  )
  assert.ok(
    staleTask instanceof Promise,
    "The first recovered status must start an in-flight application recovery task.",
  )
  assert.equal(
    reconciliationCalls,
    1,
    "The first recovery generation must enter owned-order reconciliation exactly once before the second disconnect.",
  )

  statusHandler({ type: "connectionClosed", recoveryRequired: true })
  statusHandler({ type: "recovered", recoveryRequired: true })

  assert.equal(
    state.recoveryGeneration,
    2,
    "The second transport disconnect must supersede the in-flight recovery with a new generation.",
  )
  assert.equal(
    state.ready,
    false,
    "The second disconnect must keep the trading-readiness gate closed while the old recovery task is still pending.",
  )
  assert.equal(
    state.requiresReconciliation,
    true,
    "The second disconnect must preserve the application reconciliation requirement for the new generation.",
  )
  assert.equal(
    reconciliationCalls,
    1,
    "A recovered reminder received while stale work is in flight must not start a concurrent recovery task.",
  )

  resolveFirstReconciliation({ ok: true, data: { reconciled: 2, symbols: ["DOGEUSDT"] } })
  await staleTask

  assert.equal(
    state.recoveryTask,
    null,
    "The superseded recovery task must release the single-flight slot after detecting its stale generation.",
  )
  assert.equal(
    accountAudits.length,
    0,
    "The stale first generation must not publish a recovery account audit after its reconciliation promise resolves.",
  )
  assert.equal(
    openOrdersAudits.length,
    0,
    "The stale first generation must not publish an account-wide open-orders audit.",
  )
  assert.equal(
    acknowledgements.length,
    0,
    "The stale first generation must never acknowledge the broker after the second disconnect.",
  )
  assert.equal(
    state.requiresReconciliation,
    true,
    "The stale first generation must leave the latest recovery generation blocked for reconciliation.",
  )
  assert.equal(
    logs.error[0]?.errorMessage,
    "User-data recovery generation was superseded",
    "The stale recovery task must leave an actionable generation-superseded diagnostic.",
  )

  statusHandler({ type: "recovered", recoveryRequired: true })
  const currentTask = state.recoveryTask
  await currentTask

  assert.equal(
    reconciliationCalls,
    2,
    "A later recovered reminder must start exactly one fresh owned-order reconciliation for generation two.",
  )
  assert.equal(
    accountAudits.length,
    1,
    "Only the latest recovery generation may publish the account snapshot audit.",
  )
  assert.equal(
    openOrdersAudits.length,
    1,
    "Only the latest recovery generation may publish the account-wide open-orders audit.",
  )
  assert.deepEqual(
    acknowledgements,
    [2],
    "Only the latest recovery generation may be acknowledged after both audits succeed.",
  )
  assert.deepEqual(
    ownershipReconciliations,
    [true],
    "Only the latest recovery generation may certify canonical ownership after order reconciliation.",
  )
  assert.equal(
    state.lastAcknowledgedRecoveryGeneration,
    2,
    "The acknowledged generation must be the second disconnect's current recovery generation.",
  )
  assert.equal(
    state.requiresReconciliation,
    false,
    "Successful reconciliation and acknowledgement of the latest generation must clear the application gate.",
  )
  assert.equal(
    state.streamUnsafe,
    false,
    "The terminal reconciled status for the latest generation must clear the transport-unsafe marker.",
  )
  assert.equal(
    state.ready,
    true,
    "Trading readiness may reopen only after the latest generation's audits and broker acknowledgement complete.",
  )
  assert.equal(
    state.status,
    "READY",
    "The successful latest-generation reconciliation must restore the READY application status.",
  )
  assert.equal(
    state.recoveryTask,
    null,
    "The successful latest-generation recovery task must release the single-flight slot.",
  )
  assert.equal(
    observedStatuses.filter((entry) => entry.status.type === "reconciled").length,
    1,
    "The Harvester consumer must process one terminal reconciled status for the successful current generation.",
  )
  assert.equal(
    lifecycleEvents.filter((event) => event.data?.status === "reconciled").length,
    1,
    "The Harvester lifecycle publisher must emit one reconciled status transition for the successful current generation.",
  )
})
