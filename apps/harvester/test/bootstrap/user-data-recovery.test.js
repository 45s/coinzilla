import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "./start-harvester-test-support.js"

const { waitForTestSignal, appConfig, createBroker, binanceEnv, startHarvesterForTest, createFill } = shared
const test = (...args) => nodeTest(`[user-data-recovery.test.js] ${args[0]}`, ...args.slice(1))

function createApplicationRecoveryAcknowledgementFixture({ broker }) {
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

function configureRecoverySnapshotReplay(broker) {
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

function configureStaleRecoveryRace(broker) {
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

function createRecoveryModeEventFixture({ broker }) {
  const {getAccountSnapshot} = broker
  let accountReads = 0
  let resolveRecoverySnapshotStarted
  let releaseRecoverySnapshot
  const recoverySnapshotStarted = new Promise((resolve) => {
    resolveRecoverySnapshotStarted = resolve
  })
  const recoverySnapshotGate = new Promise((resolve) => {
    releaseRecoverySnapshot = resolve
  })
  broker.getAccountSnapshot = async () => {
    accountReads += 1
    if (accountReads === 2) {
      resolveRecoverySnapshotStarted()
      await recoverySnapshotGate
    }
    return getAccountSnapshot()
  }
  let observedRecoveryMode
  let resolveObservedEvent
  const observedEvent = new Promise((resolve) => {
    resolveObservedEvent = resolve
  })
  let resolveRecoveryAcknowledged
  const recoveryAcknowledged = new Promise((resolve) => {
    resolveRecoveryAcknowledged = resolve
  })
  const {subscribeForUserData} = broker
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => {
          handlers.onStatus({
            type: "reconciled",
            recoveryRequired: false,
            reconciliationRequired: false,
          })
          resolveRecoveryAcknowledged()
          return true
        },
      },
    }
  }
  return {
    recoverySnapshotStarted,
    releaseRecoverySnapshot,
    observedEvent,
    recoveryAcknowledged,
    getAccountReads: () => accountReads,
    getObservedRecoveryMode: () => observedRecoveryMode,
    observeUserDataEvent: ({ recoveryMode }) => {
      observedRecoveryMode = recoveryMode
      resolveObservedEvent()
    },
  }
}

async function assertRecoveryModeEventObserved({ fixture, runtime, broker }) {
  await waitForTestSignal(
    fixture.recoverySnapshotStarted,
    "application recovery account snapshot",
    () => ({
      accountReads: fixture.getAccountReads(),
      userDataReady: runtime.userDataReady,
    }),
    2_000,
  )
  broker.emitUserDataEvent({
    eventType: "outboundAccountPosition",
  })
  await waitForTestSignal(
    fixture.observedEvent,
    "user-data event observed during application recovery",
    () => ({
      observedRecoveryMode: fixture.getObservedRecoveryMode(),
      userDataReady: runtime.userDataReady,
    }),
    2_000,
  )
  assert.equal(
    fixture.getObservedRecoveryMode(),
    true,
    "an event accepted while authoritative recovery is pending must be classified as recovery-mode work",
  )
}

async function assertRecoveryModeAcknowledged({ fixture, runtime }) {
  fixture.releaseRecoverySnapshot()
  await waitForTestSignal(
    fixture.recoveryAcknowledged,
    "application recovery acknowledgement after durable snapshots",
    () => ({
      accountReads: fixture.getAccountReads(),
      userDataReady: runtime.userDataReady,
    }),
    2_000,
  )
  assert.equal(
    runtime.userDataReady,
    true,
    "trading readiness must return only after the application acknowledges the fully reconciled recovery generation",
  )
}

test("does not clear a genuine startup stream-recovery gate with only the initial balance snapshot", async () => {
  const broker = createBroker()
  const {subscribeForUserData} = broker
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    handlers.onStatus({
      type: "connectionClosed",
      recoveryRequired: true
    })
    return result
  }

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: {
        ...binanceEnv,
        NODE_ENV: "development",
      },
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /user-data stream reconciliation is required/,
    "does not clear a genuine startup stream-recovery gate with only the initial balance snapshot: expected startHarvesterForTest({\n      loadConfig: async () => appConfig,\n      env: {\n        ...binanceEnv,\n        NODE_ENV: \"development\",\n      },\n      brokerAdapterFactory: () => broker,\n      logger: {\n        info() {},\n        error() {}\n      },\n    }) to reject or throw with /user-data stream reconciliation is required/ as required by the recovery safety gate.",
  )
})

test("starts application reconciliation on transport recovery and acknowledges only after durable audits", async () => {
  const calls = []
  const broker = createBroker(calls)
  const recovery = createApplicationRecoveryAcknowledgementFixture({
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

  assert.equal(result.userDataReady, true, "starts application reconciliation on transport recovery and acknowledges only after durable audits: expected result.userDataReady to equal true.")
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

  assert.equal(recovery.getAcknowledgementCount(), 1, "starts application reconciliation on transport recovery and acknowledges only after durable audits: expected recovery.getAcknowledgementCount() to equal 1.")
  assert.equal(result.userDataReady, true, "starts application reconciliation on transport recovery and acknowledges only after durable audits: expected result.userDataReady to equal true.")
  assert.equal(calls.filter((call) => call === "account:snapshot").length, 2, "starts application reconciliation on transport recovery and acknowledges only after durable audits: expected calls.filter((call) => call === \"account:snapshot\").length to equal 2.")
  assert.equal(recovery.getOpenOrderReads(), 2, "starts application reconciliation on transport recovery and acknowledges only after durable audits: expected recovery.getOpenOrderReads() to equal 2.")
  assert.ok(recovery.journalEvents.some((event) =>
    event.name === "account.snapshot_captured" && event.data.phase === "RECOVERY"), "starts application reconciliation on transport recovery and acknowledges only after durable audits: expected recovery.journalEvents.some((event) =>\n    event.name === \"account.snapshot_captured\" && event.data.phase === \"RECOVERY\") to be truthy.")
  assert.ok(recovery.journalEvents.some((event) =>
    event.name === "account.open_orders_captured" && event.data.phase === "RECOVERY"), "starts application reconciliation on transport recovery and acknowledges only after durable audits: expected recovery.journalEvents.some((event) =>\n    event.name === \"account.open_orders_captured\" && event.data.phase === \"RECOVERY\") to be truthy.")

  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  assert.equal(recovery.getAcknowledgementCount(), 1, "starts application reconciliation on transport recovery and acknowledges only after durable audits: expected recovery.getAcknowledgementCount() to equal 1.")
  assert.equal(calls.filter((call) => call === "account:snapshot").length, 2, "starts application reconciliation on transport recovery and acknowledges only after durable audits: expected calls.filter((call) => call === \"account:snapshot\").length to equal 2.")
  assert.equal(result.userDataReady, true, "starts application reconciliation on transport recovery and acknowledges only after durable audits: expected result.userDataReady to equal true.")
  await result.stop()
})

test("repeats recovery snapshots when a user-data event arrives during REST audit reads", async () => {
  const broker = createBroker()
  const recovery = configureRecoverySnapshotReplay(broker)
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
  assert.equal(recovery.getAccountReads(), 3, "repeats recovery snapshots when a user-data event arrives during REST audit reads: expected recovery.getAccountReads() to equal 3.")
  assert.equal(recovery.getOpenOrderReads(), 3, "repeats recovery snapshots when a user-data event arrives during REST audit reads: expected recovery.getOpenOrderReads() to equal 3.")
  assert.equal(recovery.getAcknowledgements(), 1, "repeats recovery snapshots when a user-data event arrives during REST audit reads: expected recovery.getAcknowledgements() to equal 1.")
  assert.equal(result.userDataReady, true, "repeats recovery snapshots when a user-data event arrives during REST audit reads: expected result.userDataReady to equal true.")
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
  assert.ok(diagnostic, "logs stack and cause details when a user-data RPC error has an empty message: expected diagnostic to be truthy.")
  assert.equal(diagnostic.statusType, "rpcError", "logs stack and cause details when a user-data RPC error has an empty message: expected diagnostic.statusType to equal \"rpcError\".")
  assert.equal(diagnostic.errorName, "TypeError", "logs stack and cause details when a user-data RPC error has an empty message: expected diagnostic.errorName to equal \"TypeError\".")
  assert.equal(diagnostic.errorMessage, "(empty error message)", "logs stack and cause details when a user-data RPC error has an empty message: expected diagnostic.errorMessage to equal \"(empty error message)\".")
  assert.match(diagnostic.errorStack, /TypeError/, "logs stack and cause details when a user-data RPC error has an empty message: expected diagnostic.errorStack to match /TypeError/.")
  assert.equal(diagnostic.causeName, "Error", "logs stack and cause details when a user-data RPC error has an empty message: expected diagnostic.causeName to equal \"Error\".")
  assert.equal(diagnostic.causeMessage, "socket callback failed", "logs stack and cause details when a user-data RPC error has an empty message: expected diagnostic.causeMessage to equal \"socket callback failed\".")
  assert.match(diagnostic.causeStack, /socket callback failed/, "logs stack and cause details when a user-data RPC error has an empty message: expected diagnostic.causeStack to match /socket callback failed/.")
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

  assert.equal(acknowledgementCount, 0, "keeps recovery blocked and does not acknowledge when the fresh account snapshot fails: expected acknowledgementCount to equal 0.")
  assert.equal(result.userDataReady, false, "keeps recovery blocked and does not acknowledge when the fresh account snapshot fails: expected result.userDataReady to equal false.")
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED", "keeps recovery blocked and does not acknowledge when the fresh account snapshot fails: expected result.userDataStatus to equal \"AUTHORITATIVE_RECONCILIATION_REQUIRED\".")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "shutdown must reject when startup recovery leaves user-data reconciliation incomplete")
})

test("does not acknowledge a stale recovery after a newer disconnect", async () => {
  const broker = createBroker()
  const race = configureStaleRecoveryRace(broker)
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
  assert.equal(race.getAcknowledgements(), 0, "does not acknowledge a stale recovery after a newer disconnect: expected race.getAcknowledgements() to equal 0.")
  assert.equal(result.userDataReady, false, "does not acknowledge a stale recovery after a newer disconnect: expected result.userDataReady to equal false.")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "does not acknowledge a stale recovery after a newer disconnect: expected result.stop() to reject or throw with /Harvester shutdown was incomplete/ as required by the recovery safety gate.")
})

test("fails startup when user-data recovery is required during subscription setup", async () => {
  const broker = createBroker()
  const {subscribeForUserData} = broker
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    handlers.onStatus({
      type: "recovered",
      recoveryRequired: true,
      reconciliationRequired: true
    })
    return result
  }
  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /user-data stream reconciliation is required/,
    "fails startup when user-data recovery is required during subscription setup: expected startHarvesterForTest({\n      loadConfig: async () => appConfig,\n      env: binanceEnv,\n      brokerAdapterFactory: () => broker,\n      logger: {\n        info() {},\n        error() {}\n      },\n    }) to reject or throw with /user-data stream reconciliation is required/ as required by the recovery safety gate.",
  )
})

test("fails startup closed when user-data subscription cannot be established", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.subscribeForUserData = async () => ({
    ok: false,
    errors: [new Error("user stream unavailable")],
  })

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /Unable to subscribe to user data: user stream unavailable/,
    "fails startup closed when user-data subscription cannot be established: expected startHarvesterForTest({\n      loadConfig: async () => appConfig,\n      env: binanceEnv,\n      brokerAdapterFactory: () => broker,\n      logger: {\n        info() {},\n        error() {}\n      },\n    }) to reject or throw with /Unable to subscribe to user data: user stream unavailable/ as required by the recovery safety gate.",
  )
  assert.deepEqual(calls, ["connect", "filters:BTCUSDT", "filters:ETHUSDT", "disconnect"], "fails startup closed when user-data subscription cannot be established: expected calls to deeply equal [\"connect\", \"filters:BTCUSDT\", \"filters:ETHUSDT\", \"disconnect\"].")
})

test("does not request another account snapshot after a TRADE when later snapshots would fail", async () => {
  const broker = createBroker()
  const {getAccountSnapshot} = broker
  let calls = 0
  broker.getAccountSnapshot = async () => {
    calls += 1
    if (calls === 1) {return getAccountSnapshot()}
    return {
      ok: false,
      errors: [new Error("account endpoint unavailable")]
    }
  }
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  })

  broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    fill: createFill({ tradeId: "account-refresh-failure" }),
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.userDataReady, false, "does not request another account snapshot after a TRADE when later snapshots would fail: expected result.userDataReady to equal false.")
  assert.equal(result.userDataStatus, "EXECUTION_ACCOUNTING_FAILED", "does not request another account snapshot after a TRADE when later snapshots would fail: expected result.userDataStatus to equal \"EXECUTION_ACCOUNTING_FAILED\".")
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }), undefined, "does not request another account snapshot after a TRADE when later snapshots would fail: expected result.portfolio.getPosition({ symbol: \"BTCUSDT\" }) to equal undefined.")
  assert.equal(result.getAccountSnapshot().sourceTime, 1, "does not request another account snapshot after a TRADE when later snapshots would fail: expected result.getAccountSnapshot().sourceTime to equal 1.")
  assert.equal(calls, 1, "does not request another account snapshot after a TRADE when later snapshots would fail: expected calls to equal 1.")
  assert.equal(result.placeOrder, undefined, "does not request another account snapshot after a TRADE when later snapshots would fail: expected result.placeOrder to equal undefined.")
  assert.equal(result.broker, undefined, "does not request another account snapshot after a TRADE when later snapshots would fail: expected result.broker to equal undefined.")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "does not request another account snapshot after a TRADE when later snapshots would fail: expected result.stop() to reject or throw with /Harvester shutdown was incomplete/ as required by the recovery safety gate.")
})

test("does not clear the ownership gate after stream recovery acknowledgement", async () => {
  const broker = createBroker()
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  })

  broker.emitUserDataStatus({
    type: "connectionClosed",
    recoveryRequired: true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(result.userDataReady, false, "does not clear the ownership gate after stream recovery acknowledgement: expected result.userDataReady to equal false.")
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED", "does not clear the ownership gate after stream recovery acknowledgement: expected result.userDataStatus to equal \"AUTHORITATIVE_RECONCILIATION_REQUIRED\".")

  broker.emitUserDataStatus({
    type: "reconciled",
    recoveryRequired: false,
    reconciliationRequired: false,
    subscriptionId: "stale-subscription",
    recoveryGeneration: 0,
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(result.userDataReady, false, "A stream acknowledgement without a matching application recovery audit cannot clear the ownership gate")
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED", "does not clear the ownership gate after stream recovery acknowledgement: expected result.userDataStatus to equal \"AUTHORITATIVE_RECONCILIATION_REQUIRED\".")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "does not clear the ownership gate after stream recovery acknowledgement: expected result.stop() to reject or throw with /Harvester shutdown was incomplete/ as required by the recovery safety gate.")
})

test("identifies user-data events received during application recovery as recovery-mode work", async () => {
  const broker = createBroker()
  const fixture = createRecoveryModeEventFixture({
    broker,
  })
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    onUserDataEvent: fixture.observeUserDataEvent,
    logger: {
      info() {},
      error() {},
    },
  })

  try {
    broker.emitUserDataStatus({
      type: "recovered",
      subscriptionId: 17,
      recoveryRequired: true,
      reconciliationRequired: true,
    })
    await assertRecoveryModeEventObserved({
      fixture,
      runtime,
      broker,
    })
    await assertRecoveryModeAcknowledged({
      fixture,
      runtime,
    })
  } finally {
    fixture.releaseRecoverySnapshot()
    await runtime.stop()
  }
})

test("reconciles the in-memory order registry before reopening trading after stream recovery", async () => {
  const broker = createBroker()
  let acknowledgementCount = 0
  let resolveAcknowledgement
  const acknowledged = new Promise((resolve) => { resolveAcknowledgement = resolve })
  const { subscribeForUserData } = broker
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
            recoveryRequired: false,
            reconciliationRequired: false,
          })
          resolveAcknowledgement()
          return true
        },
      },
    }
  }
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

  assert.equal(result.userDataReady, true, "reconciles the in-memory order registry before reopening trading after stream recovery: expected result.userDataReady to equal true.")
  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  assert.equal(result.userDataReady, false, "reconciles the in-memory order registry before reopening trading after stream recovery: expected result.userDataReady to equal false.")
  await waitForTestSignal(acknowledged, "broker recovery acknowledgement", () => ({
    acknowledgementCount,
    userDataStatus: result.userDataStatus,
  }), 2_000)

  assert.equal(acknowledgementCount, 1, "reconciles the in-memory order registry before reopening trading after stream recovery: expected acknowledgementCount to equal 1.")
  assert.equal(result.userDataReady, true, "reconciles the in-memory order registry before reopening trading after stream recovery: expected result.userDataReady to equal true.")
  assert.equal(result.userDataStatus, "READY", "reconciles the in-memory order registry before reopening trading after stream recovery: expected result.userDataStatus to equal \"READY\".")
  await result.stop()
})
