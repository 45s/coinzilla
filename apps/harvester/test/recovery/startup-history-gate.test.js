import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  appConfig,
  binanceEnv,
  createBroker,
  createFileOperationalStateStore,
  createPriorProcessHistory,
  makeVolatilityReadyBroker,
  recordConfigurationBaseline,
  recordProcessStarted,
  recordProcessStopped,
  startHarvesterForTest,
} from "../bootstrap/start-harvester-test-support.js"

function createRecoveryEnabledConfig() {
  return {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        settings: {
          ...appConfig.strategies.CG_coinGrabber.settings,
          recovery: {
            enabled: true,
          },
        },
      },
    },
  }
}

async function createRestartStore({ directory, runtimeSessionId }) {
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId,
  })
  const initialized = await store.initializeIfEmpty()
  assert.equal(initialized.ok, true, initialized.errors?.map(({ message }) => message).join("; "))
  assert.equal(initialized.data.ready, true)
  assert.equal(initialized.data.initialized, false)
  return store
}

function instrumentStoreReadAll(store) {
  let readAllCalls = 0
  const instrumentedStore = {
    ...store,
    readAll: async (...args) => {
      readAllCalls += 1
      return store.readAll(...args)
    },
  }
  return {
    store: instrumentedStore,
    getReadAllCalls: () => readAllCalls,
  }
}

function createReadyBrokerAdapterFactory({ calls, onConnect } = {}) {
  return ({ config } = {}) => {
    onConnect?.()
    return makeVolatilityReadyBroker(
      createBroker(calls, {
        tradingMode: config.tradingMode,
      }),
      ["BTCUSDT"],
    )
  }
}

async function createCleanObservationOnlyHistory({ directory, config }) {
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "prior-observation-only-session",
  })
  const initialized = await store.initialize()
  assert.equal(initialized.ok, true)
  const baseline = await recordConfigurationBaseline({
    operationalStateStore: store,
    appConfig: config,
  })
  assert.equal(baseline.ok, true)
  const started = await recordProcessStarted({
    operationalStateStore: store,
    configurationFingerprint: baseline.data.fingerprint,
    strategyName: baseline.data.strategyName,
    markets: baseline.data.markets,
    tradingEnabled: false,
  })
  assert.equal(started.ok, true)
  const stopped = await recordProcessStopped({
    operationalStateStore: store,
    reason: "CLEAN_TEST_SHUTDOWN",
    clean: true,
  })
  assert.equal(stopped.ok, true)
}

test("starts fresh current-session trading after prior process history when recovery is disabled", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-default-restart-history-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  await createPriorProcessHistory({
    directory,
    runtimeSessionId: "prior-trading-session",
    priorAppConfig: appConfig,
  })
  const restartStore = await createRestartStore({
    directory,
    runtimeSessionId: "default-observation-only-restart",
  })
  const tracked = instrumentStoreReadAll(restartStore)
  const calls = []
  let brokerFactoryCalls = 0
  let strategyEvaluationCount = 0
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    operationalStateStore: tracked.store,
    brokerAdapterFactory: ({ config } = {}) => {
      brokerFactoryCalls += 1
      assert.ok(tracked.getReadAllCalls() > 0, "Prior process history must be read before broker connection.")
      return createReadyBrokerAdapterFactory({
        calls,
      })({ config })
    },
    evaluateStrategy: async () => {
      strategyEvaluationCount += 1
      return { ok: true }
    },
    logger: {
      info() {},
      error() {},
    },
  })

  assert.equal(runtime.tradingEnabled, true, "Prior-session orders remain external; a fresh current-process session may trade without restoring prior state.")
  assert.equal(runtime.executionEnabled, true)
  assert.equal(runtime.userDataReady, true, "Fresh PREFLIGHT and current-process user-data readiness must open the gate.")
  assert.equal(brokerFactoryCalls, 1)
  await runtime.processMarketPrice({
    symbol: "BTCUSDT",
    priceEvent: {
      symbol: "BTCUSDT",
      price: "65000",
      timestamp: Date.now(),
    },
  })
  assert.ok(strategyEvaluationCount > 0, "The fresh current-process strategy must evaluate after its own market and user-data readiness are established.")
  assert.equal(calls.some((call) => typeof call === "object" && call.side), false)
  const history = await restartStore.readAll()
  const starts = history.data.records.filter((record) => record.factType === "PROCESS_STARTED")
  assert.equal(starts.at(-1).data.tradingEnabled, true, "The new durable process-start fact must record current-session trading eligibility.")
  const stopped = await runtime.stop()
  assert.equal(stopped.ok, true)
})

test("rejects recovery-enabled restart before broker connection when prior process session is unclean", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-recovery-unclean-history-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const config = createRecoveryEnabledConfig()
  await createPriorProcessHistory({
    directory,
    runtimeSessionId: "prior-unclean-recovery-session",
    priorAppConfig: config,
  })
  const restartStore = await createRestartStore({
    directory,
    runtimeSessionId: "recovery-unclean-restart",
  })
  let brokerFactoryCalls = 0
  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => config,
      env: binanceEnv,
      operationalStateStore: restartStore,
      brokerAdapterFactory: () => {
        brokerFactoryCalls += 1
        return createBroker([], {
          tradingMode: "testnet",
        })
      },
    }),
    /Automatic Harvester trading-state restoration remains disabled/,
  )
  assert.equal(brokerFactoryCalls, 0, "Unclean prior process history must block before broker connection.")
})

test("allows a clean observation-only restart without enabling trading", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-clean-observation-restart-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const config = createRecoveryEnabledConfig()
  await createCleanObservationOnlyHistory({
    directory,
    config,
  })
  const restartStore = await createRestartStore({
    directory,
    runtimeSessionId: "clean-observation-only-restart",
  })
  const tracked = instrumentStoreReadAll(restartStore)
  let brokerFactoryCalls = 0
  const calls = []
  const runtime = await startHarvesterForTest({
    loadConfig: async () => config,
    env: binanceEnv,
    operationalStateStore: tracked.store,
    brokerAdapterFactory: ({ config: brokerConfig } = {}) => {
      brokerFactoryCalls += 1
      assert.ok(tracked.getReadAllCalls() > 0, "Clean prior-session eligibility must be verified before broker connection.")
      return createReadyBrokerAdapterFactory({
        calls,
      })({ config: brokerConfig })
    },
    logger: {
      info() {},
      error() {},
    },
  })

  assert.equal(runtime.tradingEnabled, false)
  assert.equal(runtime.executionEnabled, false)
  assert.equal(brokerFactoryCalls, 1)
  assert.equal(calls.some((call) => typeof call === "object" && call.side), false)
  const stopped = await runtime.stop()
  assert.equal(stopped.ok, true)
})
