import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "./start-harvester-test-support.js"

const { waitForTestSignal, appConfig, createBroker, binanceEnv, startHarvesterForTest, createFill } = shared
const test = (...args) => nodeTest(`[user-data-event-reconciliation.test.js] ${args[0]}`, ...args.slice(1))
function createRecoveryModeObservationFixture({ broker }) {
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

  assert.equal(result.userDataReady, false, "A TRADE event that cannot be safely accounted must close user-data readiness.")
  assert.equal(result.userDataStatus, "EXECUTION_ACCOUNTING_FAILED", "The runtime must expose the terminal execution-accounting failure instead of continuing as ready.")
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }), undefined, "A rejected TRADE must not create a Portfolio position without successful accounting.")
  assert.equal(result.getAccountSnapshot().sourceTime, 1, "The accepted startup account snapshot must remain unchanged after the rejected TRADE.")
  assert.equal(calls, 1, "A TRADE event must not trigger a second account snapshot after the startup snapshot.")
  assert.equal(result.placeOrder, undefined, "A failed accounting path must not expose a direct placeOrder escape hatch.")
  assert.equal(result.broker, undefined, "A failed accounting path must not expose the broker adapter to callers.")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "Shutdown must report incomplete cleanup while the execution-accounting gate remains failed.")
})

test("identifies user-data events received during application recovery as recovery-mode work", async () => {
  const broker = createBroker()
  const fixture = createRecoveryModeObservationFixture({
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

  assert.equal(result.userDataReady, true, "The runtime must be ready only after its startup account audit has completed.")
  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  assert.equal(result.userDataReady, false, "A recovered stream must close trading readiness until the in-memory order registry is reconciled.")
  await waitForTestSignal(acknowledged, "broker recovery acknowledgement", () => ({
    acknowledgementCount,
    userDataStatus: result.userDataStatus,
  }), 2_000)

  assert.equal(acknowledgementCount, 1, "The broker must receive exactly one acknowledgement after the order registry reconciliation completes.")
  assert.equal(result.userDataReady, true, "Trading readiness must reopen only after the recovered order registry and account audit are complete.")
  assert.equal(result.userDataStatus, "READY", "The runtime must report READY only after the matching recovery generation is fully reconciled.")
  await result.stop()
})
