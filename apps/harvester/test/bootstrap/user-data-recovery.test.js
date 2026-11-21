import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "./start-harvester-test-support.js"

const { waitForTestSignal, appConfig, createBroker, binanceEnv, startHarvesterForTest } = shared
const test = (...args) => nodeTest(`[user-data-recovery.test.js] ${args[0]}`, ...args.slice(1))
function createDurableRecoveryAcknowledgementFixture({ broker }) {
  let openOrderReads = 0
  const {getOpenOrders} = broker
  broker.getOpenOrders = async (input) => {
    openOrderReads += 1
    return getOpenOrders(input)
  }
  const journalEvents = []
  const eventPublisher = {
    publish: (event) => {
      journalEvents.push(event)
      return {
        ok: true,
      }
    },
    flush: async () => ({
      ok: true,
      durable: true,
    }),
  }
  let acknowledgementCount = 0
  let resolveAcknowledgement
  const acknowledged = new Promise((resolve) => {
    resolveAcknowledgement = resolve
  })
  const {subscribeForUserData} = broker
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => {
          acknowledgementCount += 1
          handlers.onStatus({
            type: "reconciled",
            subscriptionId: 17,
            recoveryRequired: false,
            reconciliationRequired: false,
          })
          resolveAcknowledgement()
          return true
        },
      },
    }
  }
  return {
    eventPublisher,
    journalEvents,
    acknowledged,
    getAcknowledgementCount: () => acknowledgementCount,
    getOpenOrderReads: () => openOrderReads,
  }
}

function installRecoverySnapshotReplay({ broker }) {
  const { getAccountSnapshot, getOpenOrders, subscribeForUserData } = broker
  const counters = { accountReads: 0,
    openOrderReads: 0,
    acknowledgements: 0 }
  let resolveAcknowledgement
  const acknowledged = new Promise((resolve) => { resolveAcknowledgement = resolve })
  broker.getOpenOrders = async (input) => {
    counters.openOrderReads += 1
    return getOpenOrders(input)
  }
  broker.getAccountSnapshot = async () => {
    counters.accountReads += 1
    if (counters.accountReads === 2) {
      broker.emitUserDataEvent({ eventType: "outboundAccountPosition" })
    }
    return getAccountSnapshot()
  }
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => {
          counters.acknowledgements += 1
          handlers.onStatus({
            type: "reconciled",
            recoveryRequired: false,
            reconciliationRequired: false,
          })
          resolveAcknowledgement()
          return true
        },
      },
    }
  }
  return {
    acknowledged,
    getAccountReads: () => counters.accountReads,
    getOpenOrderReads: () => counters.openOrderReads,
    getAcknowledgements: () => counters.acknowledgements,
  }
}

function installStaleRecoveryGenerationRace({ broker }) {
  const { getAccountSnapshot, subscribeForUserData } = broker
  const signals = {}
  const counters = { accountReads: 0,
    acknowledgements: 0 }
  signals.recoverySnapshotStarted = new Promise((resolve) => { signals.resolveSnapshotStarted = resolve })
  signals.recoverySnapshotGate = new Promise((resolve) => { signals.releaseSnapshot = resolve })
  signals.staleFailure = new Promise((resolve) => { signals.resolveStaleFailure = resolve })
  broker.getAccountSnapshot = async () => {
    counters.accountReads += 1
    if (counters.accountReads === 2) {
      signals.resolveSnapshotStarted()
      await signals.recoverySnapshotGate
    }
    return getAccountSnapshot()
  }
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => {
          counters.acknowledgements += 1
          return true
        },
      },
    }
  }
  return {
    ...signals,
    getAccountReads: () => counters.accountReads,
    getAcknowledgements: () => counters.acknowledgements,
  }
}

test("starts application reconciliation on transport recovery and acknowledges only after durable audits", async () => {
  const calls = []
  const broker = createBroker(calls)
  const recovery = createDurableRecoveryAcknowledgementFixture({
    broker,
  })
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: recovery.eventPublisher,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {
      info() {},
      error() {},
    },
  })

  assert.equal(result.userDataReady, true, "The startup PREFLIGHT audit must complete before user-data readiness is exposed.")
  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  await waitForTestSignal(
    recovery.acknowledged,
    "application recovery acknowledgement",
    () => ({
      acknowledgementCount: recovery.getAcknowledgementCount(),
      userDataReady: result.userDataReady,
    }),
    2_000,
  )

  assert.equal(recovery.getAcknowledgementCount(), 1, "The recovered broker generation must be acknowledged exactly once after application reconciliation completes.")
  assert.equal(result.userDataReady, true, "A successfully reconciled recovery generation must restore user-data readiness.")
  assert.equal(calls.filter((call) => call === "account:snapshot").length, 2, "Recovery must obtain a fresh account snapshot in addition to the startup PREFLIGHT snapshot.")
  assert.equal(recovery.getOpenOrderReads(), 2, "Recovery must re-read account-wide open orders instead of relying on the startup snapshot.")
  assert.ok(recovery.journalEvents.some((event) =>
    event.name === "account.snapshot_captured" && event.data.phase === "RECOVERY"), "The Journal must contain the RECOVERY balance snapshot before broker acknowledgement.")
  assert.ok(recovery.journalEvents.some((event) =>
    event.name === "account.open_orders_captured" && event.data.phase === "RECOVERY"), "The Journal must contain the RECOVERY open-order snapshot before broker acknowledgement.")

  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  assert.equal(recovery.getAcknowledgementCount(), 1, "Repeating the same recovered status must not acknowledge an already completed generation twice.")
  assert.equal(calls.filter((call) => call === "account:snapshot").length, 2, "A duplicate recovered status must not repeat the completed account snapshot audit.")
  assert.equal(result.userDataReady, true, "Duplicate recovery notifications must leave the successfully reconciled runtime ready.")
  await result.stop()
})

test("repeats recovery snapshots when a user-data event arrives during REST audit reads", async () => {
  const broker = createBroker()
  const recovery = installRecoverySnapshotReplay({ broker })
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {},
    },
  })
  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  await waitForTestSignal(recovery.acknowledged, "recovery after user-data audit event", () => ({
    accountReads: recovery.getAccountReads(),
    openOrderReads: recovery.getOpenOrderReads(),
    acknowledgementCount: recovery.getAcknowledgements(),
  }), 2_000)
  assert.equal(recovery.getAccountReads(), 3, "A user-data event arriving during the recovery account read must invalidate that snapshot and trigger a fresh read.")
  assert.equal(recovery.getOpenOrderReads(), 3, "Account-wide open orders must be re-read alongside the repeated account snapshot to preserve one consistent recovery audit.")
  assert.equal(recovery.getAcknowledgements(), 1, "The broker must receive only one acknowledgement after the final repeated audit is durable.")
  assert.equal(result.userDataReady, true, "Trading readiness must return only after the repeated recovery audit completes.")
  await result.stop()
})

test("logs stack and cause details when a user-data RPC error has an empty message", async () => {
  const broker = createBroker()
  const diagnostics = []
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error: (entry) => diagnostics.push(entry),
    },
  })
  const error = new TypeError("")
  error.cause = new Error("socket callback failed")
  broker.emitUserDataStatus({
    type: "rpcError",
    error,
    recoveryRequired: false
  })

  const diagnostic = diagnostics.find((entry) =>
    entry?.message === "User-data stream error")
  assert.ok(diagnostic, "An empty-message user-data RPC error must still produce a structured diagnostic record.")
  assert.equal(diagnostic.statusType, "rpcError", "The diagnostic must preserve the original user-data RPC status type.")
  assert.equal(diagnostic.errorName, "TypeError", "The diagnostic must retain the concrete error type even when the error message is empty.")
  assert.equal(diagnostic.errorMessage, "(empty error message)", "The diagnostic must display an explicit placeholder instead of dropping an empty error message.")
  assert.match(diagnostic.errorStack, /TypeError/, "The diagnostic must preserve the original error stack for investigation.")
  assert.equal(diagnostic.causeName, "Error", "The diagnostic must retain the original cause type.")
  assert.equal(diagnostic.causeMessage, "socket callback failed", "The diagnostic must retain the original cause message.")
  assert.match(diagnostic.causeStack, /socket callback failed/, "The diagnostic must preserve the cause stack for root-cause investigation.")
  await result.stop()
})

test("keeps recovery blocked and does not acknowledge when the fresh account snapshot fails", async () => {
  const broker = createBroker()
  const {getAccountSnapshot} = broker
  let accountReads = 0
  broker.getAccountSnapshot = async () => {
    accountReads += 1
    if (accountReads === 2) {return {
      ok: false,
      errors: [new Error("account endpoint unavailable")]
    }}
    return getAccountSnapshot()
  }
  let acknowledgementCount = 0
  let resolveFailure
  const failed = new Promise((resolve) => { resolveFailure = resolve })
  const {subscribeForUserData} = broker
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => { acknowledgementCount += 1; return true },
      },
    }
  }

  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {
      info() {},
      error: (entry) => {
        if (entry?.message === "application recovery failed; trading remains blocked") {
          resolveFailure(entry)
        }
      },
    },
  })

  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  await waitForTestSignal(failed, "failed recovery audit", () => ({
    accountReads,
    acknowledgementCount
  }), 2_000)

  assert.equal(acknowledgementCount, 0, "A failed authoritative account snapshot must never be acknowledged as a reconciled broker generation.")
  assert.equal(result.userDataReady, false, "Trading readiness must remain closed when the fresh account reconciliation fails.")
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED", "The runtime must explicitly report that authoritative reconciliation is still required.")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "Shutdown must report incomplete cleanup while the recovery gate remains unresolved.")
})

test("does not acknowledge a stale recovery after a newer disconnect", async () => {
  const broker = createBroker()
  const race = installStaleRecoveryGenerationRace({ broker })
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {
      info() {},
      error: (entry) => {
        if (entry?.message === "application recovery failed; trading remains blocked") {
          race.resolveStaleFailure(entry)
        }
      },
    },
  })
  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  await waitForTestSignal(race.recoverySnapshotStarted, "recovery account snapshot", () => ({
    accountReads: race.getAccountReads(),
  }), 2_000)
  broker.emitUserDataStatus({
    type: "connectionClosed",
    code: 1006,
    recoveryRequired: true,
  })
  race.releaseSnapshot()
  await waitForTestSignal(race.staleFailure, "stale recovery rejection", () => ({
    accountReads: race.getAccountReads(),
    acknowledgementCount: race.getAcknowledgements(),
  }), 2_000)
  assert.equal(race.getAcknowledgements(), 0, "A superseded recovery generation must never acknowledge the broker after a newer disconnect.")
  assert.equal(result.userDataReady, false, "The newer disconnect must keep trading readiness closed until its own reconciliation completes.")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "Shutdown must remain incomplete while the current recovery generation is unreconciled.")
})
