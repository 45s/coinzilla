import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "./start-harvester-test-support.js"

const { mkdtemp, rm, os, path, prepareHarvesterStartupState, resolveHarvesterOptions, createRecoverySellerStopWorkflow, createFileOperationalStateStore, recordConfigurationBaseline, recordProcessStarted, recordProcessStopped, testEventPublisher, appConfig, createBroker, binanceEnv, startHarvesterForTest, createPriorProcessHistory } = shared
const test = (...args) => nodeTest(`[process-lifecycle-recovery.test.js] ${args[0]}`, ...args.slice(1))

function configureNoReplayHistoryBroker(broker) {
  const historicalReads = []
  broker.getCanonicalOrder = async () => {
    historicalReads.push("getCanonicalOrder")
    return { ok: false,
      errors: [new Error("not found")] }
  }
  broker.getCanonicalOrderHistory = async () => {
    historicalReads.push("getCanonicalOrderHistory")
    return { ok: true,
      data: [] }
  }
  broker.getFills = async () => {
    historicalReads.push("getFills")
    return { ok: true,
      data: [] }
  }
  broker.getExchangeMarkets = async () => {
    historicalReads.push("getExchangeMarkets")
    return { ok: true,
      data: [] }
  }
  return historicalReads
}

async function seedRecoverySellerStopStore({ directory } = {}) {
  const previousStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "rs-stop-bootstrap-previous-session",
  })
  const initialized = await previousStore.initialize()
  assert.equal(initialized.ok, true, initialized.errors?.[0]?.message)
  const baseline = await recordConfigurationBaseline({
    operationalStateStore: previousStore,
    appConfig,
  })
  assert.equal(baseline.ok, true, baseline.errors?.[0]?.message)
  const previousProcess = await recordProcessStarted({
    operationalStateStore: previousStore,
    configurationFingerprint: baseline.data.fingerprint,
    strategyName: baseline.data.strategyName,
    markets: baseline.data.markets,
    tradingEnabled: true,
  })
  assert.equal(previousProcess.ok, true, previousProcess.errors?.[0]?.message)
  const workflow = await createRecoverySellerStopWorkflow({
    operationalStateStore: previousStore,
  })
  assert.equal(workflow.ok, true, workflow.errors?.[0]?.message)
  const blocker = await workflow.data.latch({
    explanation: "Persisted RS test blocker",
    orderIdentity: {
      clientOrderId: "h-btcusdt-rs-stop-test",
    },
  })
  assert.equal(blocker.ok, true, blocker.errors?.[0]?.message)
  const stopped = await recordProcessStopped({
    operationalStateStore: previousStore,
    reason: "NORMAL",
    clean: true,
  })
  assert.equal(stopped.ok, true, stopped.errors?.[0]?.message)
  return blocker
}

function createObservedRecoverySellerStore({ directory } = {}) {
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "rs-stop-bootstrap-current-session",
  })
  const calls = []
  const operationalStateStore = {
    runtimeSessionId: store.runtimeSessionId,
    append: async (input) => {
      calls.push(input.factType)
      return store.append(input)
    },
    verify: async (...args) => store.verify(...args),
    readAll: async (...args) => {
      calls.push("READ_ALL")
      return store.readAll(...args)
    },
  }
  return {
    calls,
    operationalStateStore,
  }
}

async function createRecoverySellerStartupConfig() {
  const baseResolved = await resolveHarvesterOptions({
    appConfig,
    env: binanceEnv,
    eventPublisher: testEventPublisher,
    logger: {},
    executionRoutes: [
      {
        strategyId: "CG_coinGrabber",
        symbol: "BTCUSDT",
      },
    ],
  })
  return Object.freeze({
    ...baseResolved,
    recoverySellerPairs: {
      BTCUSDT: {
        enabled: true,
        investment: 100,
        orderQuantity: 0.01,
        sellQuantity: 0.001,
        minProfit: 0.01,
        priceStepPercent: 0.05,
        makerPercent: 0,
        takerPercent: 0,
        legacyPosition: {
          invested: 65,
          quantity: 0.001,
        },
      },
    },
  })
}

test("starts from fresh in-memory state without replaying historical Journal records", async () => {
  const calls = []
  const broker = createBroker(calls)
  const historicalReads = configureNoReplayHistoryBroker(broker)
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    journalRecoveryRecords: [{
      id: "malformed-historical-record",
      payload: {
        id: "malformed-historical-record",
        name: "execution.fill_applied",
        data: { fillId: "legacy-fill-without-tradeId" },
      },
      position: {
        fileName: "session.jsonl",
        lineNumber: 1,
      },
    }],
    logger: {
      info() {},
      error() {},
    },
  })
  assert.equal(runtime.tradingEnabled, true, "starts from fresh in-memory state without replaying historical Journal records: expected runtime.tradingEnabled to equal true.")
  assert.equal(runtime.userDataReady, true, "starts from fresh in-memory state without replaying historical Journal records: expected runtime.userDataReady to equal true.")
  assert.deepEqual(runtime.subscriptions, ["BTCUSDT"], "starts from fresh in-memory state without replaying historical Journal records: expected runtime.subscriptions to deeply equal [\"BTCUSDT\"].")
  assert.deepEqual(historicalReads, [], "starts from fresh in-memory state without replaying historical Journal records: expected historicalReads to deeply equal [].")
  assert.equal(calls.includes("account:snapshot"), true, "starts from fresh in-memory state without replaying historical Journal records: expected calls.includes(\"account:snapshot\") to equal true.")
  assert.equal(calls.includes("subscribe:user-data"), true, "starts from fresh in-memory state without replaying historical Journal records: expected calls.includes(\"subscribe:user-data\") to equal true.")
  assert.equal(calls.includes("subscribe:book:BTCUSDT"), true, "starts from fresh in-memory state without replaying historical Journal records: expected calls.includes(\"subscribe:book:BTCUSDT\") to equal true.")
  assert.equal(calls.includes("subscribe:BTCUSDT"), true, "starts from fresh in-memory state without replaying historical Journal records: expected calls.includes(\"subscribe:BTCUSDT\") to equal true.")
  await runtime.stop()
})

test("verifies an injected Operational State Store before connecting to the broker", async () => {
  const calls = []
  await assert.rejects(
    () => startHarvesterForTest({
      appConfig,
      operationalStateStore: {
        append: async () => ({
          ok: true,
          data: { durable: true }
        }),
        verify: async () => ({
          ok: false,
          errors: [new Error("durable ledger integrity failed")]
        }),
        readAll: async () => ({
          ok: true,
          data: { records: [] }
        }),
      },
      brokerAdapterFactory: () => {
        calls.push("broker-factory")
        return createBroker(calls)
      },
    }),
    /durable ledger integrity failed/,
    "verifies an injected Operational State Store before connecting to the broker: expected () => startHarvesterForTest({\n      appConfig,\n      operationalStateStore: {\n        append: async () => ({\n          ok: true,\n          data: { durable: true }\n        }),\n        verify: async () => ({\n          ok: false,\n          errors: [new Error(\"durable ledger integrity failed\")]\n        }),\n        readAll: async () => ({\n          ok: true,\n          data: { records: [] }\n        }),\n      },\n      brokerAdapterFactory: () => {\n        calls.push(\"broker-factory\")\n        return createBroker(calls)\n      },\n    }) to reject or throw with /durable ledger integrity failed/ as required by the process lifecycle safety gate.",
  )
  assert.deepEqual(calls, [], "An unverified Operational State Store must block broker connection and subscriptions.")
})

test("restores the durable RS STOP latch before writing PROCESS_STARTED", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-rs-stop-bootstrap-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const blocker = await seedRecoverySellerStopStore({ directory })
  const { calls, operationalStateStore } = createObservedRecoverySellerStore({ directory })
  const resolved = await createRecoverySellerStartupConfig()
  const startup = await prepareHarvesterStartupState({
    dependencies: {
      env: binanceEnv,
      runtimeSessionId: "rs-stop-bootstrap-current-session",
      suppliedOperationalStateStore: operationalStateStore,
      logger: {},
    },
    resolved,
  })

  assert.equal(startup.recoverySellerStopWorkflow.getStopState().status, "STOPPED", "restores the durable RS STOP latch before writing PROCESS_STARTED: expected startup.recoverySellerStopWorkflow.getStopState().status to equal \"STOPPED\".")
  assert.equal(startup.recoverySellerStopWorkflow.getBlockerId(), blocker.data.record.data.blockerId, "restores the durable RS STOP latch before writing PROCESS_STARTED: expected startup.recoverySellerStopWorkflow.getBlockerId() to equal blocker.data.record.data.blockerId.")
  assert.equal(startup.startupOptions.tradingEnabled, true, "A prior-process RS STOP must remain strategy-scoped and must not globally disable a fresh current-process session.")
  assert.equal(startup.recoverySellerStopWorkflow.isBuyAdmissionBlocked(), true, "The persisted RS STOP must continue blocking investment BUY admission.")
  assert.equal(startup.recoverySellerStopWorkflow.isSellAdmissionBlocked(), false, "The persisted RS STOP must continue allowing recovery SELL admission.")
  const processStartIndex = calls.indexOf("PROCESS_STARTED")
  const lastReadIndex = calls.lastIndexOf("READ_ALL")
  assert.ok(processStartIndex >= 0, "The current process boundary must be persisted.")
  assert.ok(lastReadIndex >= 0 && lastReadIndex < processStartIndex, "RS STOP history must be restored before PROCESS_STARTED is written.")
})

test("records configuration and process boundaries before broker startup and after shutdown", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-process-boundaries-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true
  }))
  const operationalStateStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "start-harvester-process-boundary-test",
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  })
  await operationalStateStore.initialize()

  const harvester = await startHarvesterForTest({
    appConfig,
    operationalStateStore
  })
  const started = await operationalStateStore.readAll()
  assert.equal(started.ok, true, started.errors?.[0]?.message)
  const configuration = started.data.records.find(({ factType }) => factType === "CONFIGURATION_BASELINE")
  const processStart = started.data.records.find(({ factType }) => factType === "PROCESS_STARTED")
  assert.ok(configuration, "The sanitized strategy configuration fingerprint must be durable before broker startup.")
  assert.ok(processStart, "The current process boundary must be durable before broker startup.")
  assert.equal(configuration.runtimeSessionId, "start-harvester-process-boundary-test", "records configuration and process boundaries before broker startup and after shutdown: expected configuration.runtimeSessionId to equal \"start-harvester-process-boundary-test\".")
  assert.deepEqual(configuration.data.markets, ["BTCUSDT"], "The effective configuration baseline must list enabled markets only, not disabled pair definitions.")
  assert.equal(processStart.runtimeSessionId, "start-harvester-process-boundary-test", "records configuration and process boundaries before broker startup and after shutdown: expected processStart.runtimeSessionId to equal \"start-harvester-process-boundary-test\".")
  assert.equal(processStart.data.configurationFingerprint, configuration.data.fingerprint, "records configuration and process boundaries before broker startup and after shutdown: expected processStart.data.configurationFingerprint to equal configuration.data.fingerprint.")
  assert.equal(processStart.data.tradingEnabled, true, "The durable process boundary must preserve whether this session could submit orders.")

  await harvester.stop()

  const stopped = await operationalStateStore.readAll()
  assert.equal(stopped.ok, true, stopped.errors?.[0]?.message)
  const processStop = stopped.data.records.find(({ factType }) => factType === "PROCESS_STOPPED")
  assert.ok(processStop, "A clean shutdown must durably close the process boundary.")
  assert.equal(processStop.runtimeSessionId, "start-harvester-process-boundary-test", "records configuration and process boundaries before broker startup and after shutdown: expected processStop.runtimeSessionId to equal \"start-harvester-process-boundary-test\".")
  assert.equal(processStop.data.clean, true, "records configuration and process boundaries before broker startup and after shutdown: expected processStop.data.clean to equal true.")
})

test("starts a fresh current-session runtime after a clean prior process when restart recovery is disabled", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-restart-gate-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  await createPriorProcessHistory({
    directory,
    runtimeSessionId: "first-process-session",
    priorAppConfig: appConfig,
    clean: true,
  })

  const restartStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "second-process-session",
  })
  const runtime = await startHarvesterForTest({
    appConfig,
    operationalStateStore: restartStore,
  })
  assert.equal(runtime.connected, true, "a clean prior process must not prevent current-process startup")
  assert.equal(runtime.tradingEnabled, true, "prior-session orders remain external and must not globally disable a fresh current-process session when recovery is disabled")
  assert.equal(runtime.userDataReady, true, "fresh PREFLIGHT and current-process user-data readiness must open the trading gate")
  await runtime.stop()
})

test("starts a fresh current-session runtime after an unclean prior process when restart recovery is disabled", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-crash-restart-gate-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  await createPriorProcessHistory({
    directory,
    runtimeSessionId: "crashed-process-session",
    priorAppConfig: appConfig,
  })

  const restartStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "post-crash-process-session",
  })
  const runtime = await startHarvesterForTest({
    appConfig,
    operationalStateStore: restartStore,
  })
  assert.equal(runtime.connected, true, "an unclean prior process must not prevent current-process startup")
  assert.equal(runtime.tradingEnabled, true, "prior-session orders remain external; fresh current-session trading is gated by current PREFLIGHT and safety checks, not replay")
  assert.equal(runtime.userDataReady, true, "fresh PREFLIGHT and current-process user-data readiness must open the trading gate")
  await runtime.stop()
})
