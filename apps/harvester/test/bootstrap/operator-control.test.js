import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "./start-harvester-test-support.js"

const { appConfig, createBroker, binanceEnv, startHarvesterForTest, createPriorProcessHistory, waitForTestSignal, mkdtemp, rm, os, path, createFileOperationalStateStore } = shared
const test = (...args) => nodeTest(`[operator-control.test.js] ${args[0]}`, ...args.slice(1))

function createTelegramOperatorConfig() {
  return {
    ...appConfig,
    operatorControl: {
      telegram: {
        enabled: true,
        allowedUserIds: ["12345"],
      },
    },
  }
}

function createOperatorControlOperationalStateStore({ calls, appendedFacts }) {
  return {
    runtimeSessionId: "test-runtime-session",
    verify: async () => {
      calls.push("verify-Operational State Store records")
      return {
        ok: true,
        data: {
          valid: true,
          durableWriteSupported: true,
        },
      }
    },
    readAll: async () => ({
      ok: true,
      data: {
        records: [
          {
            sequence: "0",
            factId: "durable-facts:genesis",
            factType: "LEDGER_INITIALIZED",
            runtimeSessionId: "test-runtime-session",
            data: { schemaVersion: 1 },
          },
          ...appendedFacts,
        ],
        durableWriteSupported: true,
        lastCommittedSequence: String(appendedFacts.length),
        lastCommittedDigest: "a".repeat(64),
      },
    }),
    append: async (fact) => {
      calls.push(
        fact.factType === "OPERATOR_MARKET_BUYS_PAUSED" || fact.factType === "OPERATOR_MARKET_BUYS_RESUMED"
          ? "append-operator-fact"
          : "append-process-fact",
      )
      appendedFacts.push({
        ...fact,
        sequence: String(appendedFacts.length + 1),
        runtimeSessionId: "test-runtime-session",
      })
      return {
        ok: true,
        data: {
          durable: true,
          duplicate: false,
        },
      }
    },
  }
}

function createTelegramProcessLocalRuntimeFixture({ calls, appendedFacts, broker, onOperator }) {
  const operationalStateStore = createOperatorControlOperationalStateStore({ calls,
    appendedFacts })
  let operator
  const runtime = startHarvesterForTest({
    loadConfig: async () => createTelegramOperatorConfig(),
    env: {
      ...binanceEnv,
      TELEGRAM_BOT_TOKEN: "test-telegram-token",
      OPERATIONAL_STATE_DIRECTORY: process.cwd(),
    },
    runtimeSessionId: "test-runtime-session",
    createOperationalStateStore: ({ directory, runtimeSessionId }) => {
      calls.push("create-Operational State Store records-store")
      assert.equal(directory, process.cwd(), "The Telegram adapter must receive the configured process-local state directory.")
      assert.equal(runtimeSessionId, "test-runtime-session", "The Telegram adapter must share the current Harvester runtime session identity.")
      return operationalStateStore
    },
    createTelegramOperatorAdapter: ({ botToken, allowedUserIds, operator: suppliedOperator }) => {
      calls.push("create-telegram-adapter")
      assert.equal(botToken, "test-telegram-token", "The Telegram adapter must receive the configured bot token.")
      assert.deepEqual(allowedUserIds, ["12345"], "The Telegram adapter must receive only the configured authorized user IDs.")
      operator = suppliedOperator
      onOperator?.(operator)
      return {
        start: async () => calls.push("start-telegram-poller"),
        stop: async () => calls.push("stop-telegram-poller"),
      }
    },
    brokerAdapterFactory: () => broker,
    logger: { info() {},
      error() {} },
  })
  return { runtime,
    getOperator: () => operator }
}

async function assertTelegramPauseCommandIsDurable({ operator, operationalStateStore } = {}) {
  const pauseResult = await operator.pauseMarket({
    actor: {
      id: "telegram-user:12345",
      roles: ["trading-operator"],
    },
    requestId: "telegram-after-unrecovered-restart",
    symbol: "BTCUSDT",
  })
  assert.equal(pauseResult.ok, true, "authorized Telegram pause commands must remain usable in observation-only mode")
  const persistedFacts = await operationalStateStore.readAll()
  assert.equal(persistedFacts.ok, true, "The process-owned Operational State Store must remain readable after the pause command.")
  assert.equal(
    persistedFacts.data.records.some((record) => record.factType === "OPERATOR_MARKET_BUYS_PAUSED"),
    true,
    "the observation-only Telegram pause command must still be durably recorded before it is applied",
  )
}

function attachSharedOperatorRecoveryAcknowledgement(broker) {
  let resolveRecoveryAcknowledgement
  const recoveryAcknowledged = new Promise((resolve) => {
    resolveRecoveryAcknowledgement = resolve
  })
  const { subscribeForUserData } = broker
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => {
          handlers.onStatus({
            type: "reconciled",
              recoveryGeneration: 1,
            subscriptionId: 17,
            recoveryRequired: false,
            reconciliationRequired: false,
          })
          resolveRecoveryAcknowledgement()
          return true
        },
      },
    }
  }
  return recoveryAcknowledged
}

function createSharedOperatorRuntimeConfig() {
  return {
    ...appConfig,
    operatorControl: {
      telegram: {
        enabled: true,
        allowedUserIds: ["12345"],
      },
    },
  }
}

async function startSharedOperatorRuntime({ broker, operationalStateStore, runtimeSessionId, config }) {
  let operator
  let secondaryStoreFactoryCalls = 0
  const runtime = await startHarvesterForTest({
    appConfig: config,
    operationalStateStore,
    runtimeSessionId,
    env: {
      ...binanceEnv,
      TELEGRAM_BOT_TOKEN: "test-telegram-token",
    },
    brokerAdapterFactory: () => broker,
    createOperationalStateStore: () => {
      secondaryStoreFactoryCalls += 1
      throw new Error("The process must not create a second writer for its Operational State Store.")
    },
    createTelegramOperatorAdapter: ({ operator: suppliedOperator }) => {
      operator = suppliedOperator
      return {
        start: async () => ({ started: true }),
        stop: async () => ({ stopped: true }),
      }
    },
    logger: {
      info() {},
      error() {},
    },
  })
  return {
    runtime,
    operator,
    getSecondaryStoreFactoryCalls: () => secondaryStoreFactoryCalls,
  }
}

async function createSharedOperatorRuntimeFixture({ broker, operationalStateStore, runtimeSessionId }) {
  const recoveryAcknowledged = attachSharedOperatorRecoveryAcknowledgement(broker)
  const config = createSharedOperatorRuntimeConfig()
  const runtimeFixture = await startSharedOperatorRuntime({
    broker,
    operationalStateStore,
    runtimeSessionId,
    config,
  })
  return {
    ...runtimeFixture,
    recoveryAcknowledged,
  }
}

async function assertOperatorPauseSurvivesReconnect({ fixture, broker }) {
  const pause = await fixture.operator.pauseMarket({
    actor: {
      id: "telegram-user:12345",
      roles: ["trading-operator"],
    },
    requestId: "telegram:shared-store-test",
    symbol: "BTCUSDT",
  })
  assert.equal(pause.ok, true, "An authorized operator pause must append through the process-owned store.")

  broker.emitUserDataStatus({
    type: "connectionClosed",
    reason: "test-disconnect",
  })
  broker.emitUserDataStatus({
    type: "recovered",
      recoveryGeneration: 1,
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  await waitForTestSignal(
    fixture.recoveryAcknowledged,
    "operator pause retention after user-data reconnect",
    () => ({
      recoveryAcknowledged: true,
    }),
    2_000,
  )
  const actor = {
    id: "telegram-user:12345",
    roles: ["trading-operator"],
  }
  const reconnectedStatus = await fixture.operator.getStatus({
    actor,
  })
  assert.equal(reconnectedStatus.ok, true, "The operator status query must succeed after user-data reconciliation.")
  assert.equal(reconnectedStatus.data.userData.ready, true, "User-data readiness must reopen only after recovery reconciliation is acknowledged.")
  const reconnectedMarkets = await fixture.operator.getMarkets({
    actor,
  })
  assert.equal(reconnectedMarkets.ok, true, "The operator market query must succeed after reconnect.")
  assert.equal(
    reconnectedMarkets.data.markets.find(({ symbol }) => symbol === "BTCUSDT")?.operatorBuysPaused,
    true,
    "A user-data disconnect/reconnect and successful reconciliation must not silently clear the process-lifetime operator pause.",
  )
}

async function assertOperatorReadOnlyQueries({ operator }) {
  const actor = {
    id: "telegram-user:12345",
    roles: ["trading-operator"],
  }
  const status = await operator.getStatus({
    actor,
  })
  assert.equal(status.ok, true, "The read-only operator status query must return a successful result.")
  assert.equal(status.data.runtimeState, "RUNNING", "The operator status query must report the runtime as running.")
  assert.equal(status.data.broker, "binance", "The operator status query must identify the active Binance provider.")
  assert.equal(typeof status.data.userData.ready, "boolean", "The operator status query must expose user-data readiness as a boolean.")
  const markets = await operator.getMarkets({
    actor,
  })
  assert.equal(markets.ok, true, "The read-only operator market query must return a successful result.")
  assert.ok(markets.data.markets.some(({ symbol }) => symbol === "BTCUSDT"), "The operator market query must include the configured BTCUSDT market.")
}

async function assertSharedOperatorFactsPersisted({ operationalStateStore, runtimeSessionId, fixture }) {
  const read = await operationalStateStore.readAll()
  assert.equal(read.ok, true, read.errors?.[0]?.message)
  assert.equal(fixture.getSecondaryStoreFactoryCalls(), 0, "The runtime must reuse the process-owned Operational State Store instead of creating a second writer.")
  const pauseFact = read.data.records.find(({ factType }) => factType === "OPERATOR_MARKET_BUYS_PAUSED")
  assert.ok(pauseFact, "The process-owned ledger must contain the durable operator pause fact.")
  assert.equal(pauseFact.runtimeSessionId, runtimeSessionId, "The operator pause fact must remain scoped to the current runtime session.")
  assert.equal(
    read.data.records.some(({ factType }) => factType === "OPERATOR_MARKET_RESUMED"),
    false,
    "The operator pause must remain latched; no resume fact may be written during reconnect.",
  )
  assert.equal(read.data.records.filter(({ factType }) => factType === "PROCESS_STARTED").length, 1, "The shared ledger must contain exactly one process-start fact for this runtime.")
  assert.equal(read.data.records.filter(({ factType }) => factType === "PROCESS_STOPPED").length, 1, "The shared ledger must contain exactly one process-stop fact for this runtime.")
}

function createTelegramNoReplayConfig() {
  return {
    ...appConfig,
    operatorControl: {
      telegram: {
        enabled: true,
        allowedUserIds: ["12345"],
      },
    },
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        settings: {
          ...appConfig.strategies.CG_coinGrabber.settings,
          recovery: { enabled: false },
        },
      },
    },
  }
}

test("rejects enabled Telegram operator control without a bot token before connecting to Binance", async () => {
  const config = {
    ...appConfig,
    operatorControl: { telegram: {
      enabled: true,
      allowedUserIds: ["12345"]
    } },
  }
  let brokerFactoryCalled = false

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => config,
      env: {
        ...binanceEnv,
        TELEGRAM_BOT_TOKEN: undefined,
        OPERATIONAL_STATE_DIRECTORY: process.cwd()
      },
      brokerAdapterFactory: () => {
        brokerFactoryCalled = true
        throw new Error("Broker connection must not start before operator-control configuration is validated.")
      },
    }),
    (error) => error.code === "OPERATOR_CONTROL_TELEGRAM_TOKEN_REQUIRED",
    "Enabled inbound control must reject missing Telegram credentials before any broker connection is attempted.",
  )

  assert.equal(brokerFactoryCalled, false, "Invalid operator-control configuration must fail before Binance adapter construction.")
})

test("starts Telegram CC without constructing or verifying the recovery store", async () => {
  const config = {
    ...appConfig,
    operatorControl: { telegram: { enabled: true,
allowedUserIds: ["12345"] } },
  }
  let storeFactoryCalls = 0
  let adapterStarted = false
  const broker = createBroker()
  const runtime = await startHarvesterForTest({
    loadConfig: async () => config,
    env: { ...binanceEnv,
TELEGRAM_BOT_TOKEN: "test-telegram-token" },
    createOperationalStateStore: () => {
      storeFactoryCalls += 1
      throw new Error("Telegram CC must not construct or verify ADR-0001 recovery storage.")
    },
    createTelegramOperatorAdapter: () => ({
      start: async () => { adapterStarted = true },
      stop: async () => ({ stopped: true }),
    }),
    brokerAdapterFactory: () => broker,
    logger: { info() {},
error() {} },
  })
  try {
    assert.equal(storeFactoryCalls, 0, "Telegram CC must not construct the recovery store when restart recovery is disabled.")
    assert.equal(adapterStarted, true, "Telegram polling must start without an initialized recovery store.")
    assert.equal(runtime.connected, true, "The recovery-store gate must not block broker/runtime startup.")
  } finally {
    await runtime.stop()
  }
})

test("retries Telegram adapter shutdown during startup rollback before giving up", async () => {
  const config = createTelegramOperatorConfig()
  const calls = []
  let stopAttempts = 0
  const broker = createBroker(calls)
  const operationalStateStore = createOperatorControlOperationalStateStore({
    calls,
    appendedFacts: [],
  })
  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => config,
    env: {
      ...binanceEnv,
      TELEGRAM_BOT_TOKEN: "test-telegram-token",
      OPERATIONAL_STATE_DIRECTORY: process.cwd()
    },
    runtimeSessionId: "test-runtime-session",
    createOperationalStateStore: () => operationalStateStore,
    createTelegramOperatorAdapter: () => ({
      start: async () => { throw new Error("Telegram getMe unauthorized") },
      stop: async () => {
        stopAttempts += 1
        if (stopAttempts === 1) {
          throw new Error("temporary adapter shutdown failure")
        }
        calls.push("telegram-stop-confirmed")
        return { stopped: true }
      },
    }),
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  }), (error) => error.code === "OPERATOR_CONTROL_TELEGRAM_START_FAILED", "Telegram startup must still fail after cleanup is retried.")
  assert.equal(stopAttempts, 2, "The outer startup rollback must retry adapter shutdown when the adapter start rollback could not confirm it.")
  assert.ok(calls.includes("telegram-stop-confirmed"), "The retry must confirm the poller has stopped before broker cleanup completes.")
  assert.ok(calls.includes("disconnect"), "The broker must still be disconnected after failed Telegram startup.")
})

test("keeps inbound operator control disabled without constructing its store or Telegram adapter", async () => {
  let storeFactoryCalls = 0
  let adapterFactoryCalls = 0
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    createOperationalStateStore: () => { storeFactoryCalls += 1; throw new Error("Disabled operator control must not open the Operational State Store.") },
    createTelegramOperatorAdapter: () => { adapterFactoryCalls += 1; throw new Error("Disabled operator control must not construct a Telegram adapter.") },
    logger: {
      info() {},
      error() {}
    },
  })
  try {
    assert.equal(storeFactoryCalls, 0, "Disabled operator control must not inspect or open the Operational State Store.")
    assert.equal(adapterFactoryCalls, 0, "Disabled operator control must not construct an inbound Telegram adapter.")
  } finally { await runtime.stop() }
})

test("starts/stops Telegram CC and applies process-local pause without recovery storage", async () => {
  const calls = []
  const appendedFacts = []
  const broker = createBroker(calls)
  let placeOrderCalls = 0
  let cancelOrderCalls = 0
  broker.placeOrder = async () => { placeOrderCalls += 1; return { ok: true } }
  broker.cancelOrder = async () => { cancelOrderCalls += 1; return { ok: true } }
  const fixture = createTelegramProcessLocalRuntimeFixture({
    calls,
    appendedFacts,
    broker,
  })
  const runtime = await fixture.runtime
  const operator = fixture.getOperator()
  try {
    assert.equal(calls.includes("create-Operational State Store records-store"), false, "Process-local Telegram control must not create a second durable store.")
    assert.equal(calls.includes("verify-Operational State Store records"), false, "Process-local Telegram control must not verify restart-recovery storage.")
    assert.ok(calls.indexOf("start-telegram-poller") < calls.indexOf("subscribe:user-data"), "Telegram polling must start before the runtime begins user-data intake.")
    const pauseResult = await operator.pauseMarket({
      actor: { id: "telegram-user:12345",
        roles: ["trading-operator"] },
      requestId: "telegram:9001",
      symbol: "BTCUSDT",
    })
    assert.equal(pauseResult.ok, true, "The authorized Telegram pause request must be accepted.")
    assert.equal(pauseResult.data.durable, false, "Process-local pause state must be reported as non-durable when recovery storage is disabled.")
    assert.equal(appendedFacts.some(({ factType }) =>
      factType === "OPERATOR_MARKET_BUYS_PAUSED" || factType === "OPERATOR_MARKET_BUYS_RESUMED"), false, "Process-local pause changes must not append durable operator facts.")
    assert.equal(calls.includes("append-operator-fact"), false, "No durable operator pause fact may be written when restart recovery storage is disabled.")
    assert.equal(placeOrderCalls, 0, "Pausing a market must not submit a broker order.")
    assert.equal(cancelOrderCalls, 0, "Pausing a market must not cancel an existing broker order.")
  } finally {
    await runtime.stop()
  }
  assert.ok(calls.indexOf("stop-telegram-poller") < calls.indexOf("disconnect"), "Telegram polling must stop before the broker connection is closed.")
})

test("stops Telegram and broker when Telegram identity verification fails during startup", async () => {
  const config = createTelegramOperatorConfig()
  const calls = []
  const broker = createBroker(calls)
  const operationalStateStore = createOperatorControlOperationalStateStore({
    calls,
    appendedFacts: [],
  })
  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => config,
    env: {
      ...binanceEnv,
      TELEGRAM_BOT_TOKEN: "test-telegram-token",
      OPERATIONAL_STATE_DIRECTORY: process.cwd()
    },
    runtimeSessionId: "test-runtime-session",
    createOperationalStateStore: () => operationalStateStore,
    createTelegramOperatorAdapter: () => ({
      start: async () => { calls.push("start-telegram-poller"); throw new Error("Telegram getMe unauthorized") },
      stop: async () => calls.push("stop-telegram-poller")
    }),
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  }), (error) => error.code === "OPERATOR_CONTROL_TELEGRAM_START_FAILED", "Telegram identity verification failure must abort startup.")
  assert.ok(calls.includes("stop-telegram-poller"), "A partially started Telegram adapter must be stopped during startup rollback.")
  assert.ok(calls.includes("disconnect"), "The broker must be disconnected during startup rollback.")
  assert.equal(calls.includes("subscribe:user-data"), false, "Trading subscriptions must not begin after Telegram identity verification fails.")
})

test("reuses the process-owned Operational State Store and preserves operator pause across user-data reconnect", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-shared-operator-facts-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const runtimeSessionId = "shared-process-operator-session"
  const operationalStateStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId,
  })
  await operationalStateStore.initialize()
  const broker = createBroker()
  const fixture = await createSharedOperatorRuntimeFixture({
    broker,
    operationalStateStore,
    runtimeSessionId,
  })

  try {
    await assertOperatorPauseSurvivesReconnect({
      fixture,
      broker,
    })
    await assertOperatorReadOnlyQueries({
      operator: fixture.operator,
    })
  } finally {
    await fixture.runtime.stop()
  }
  await assertSharedOperatorFactsPersisted({
    operationalStateStore,
    runtimeSessionId,
    fixture,
  })
})

test("starts Telegram operator control without running process-restart recovery when recovery is disabled", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-operator-control-no-replay-"))
  const config = createTelegramNoReplayConfig()
  let operatorAdapterStarted = false
  let operator
  let runtime
  try {
    await createPriorProcessHistory({
      directory,
      runtimeSessionId: "previous-process-session",
      priorAppConfig: config,
    })
    const currentStore = createFileOperationalStateStore({
      directory,
      runtimeSessionId: "current-process-session",
    })
    runtime = await startHarvesterForTest({
      loadConfig: async () => config,
      env: {
        ...binanceEnv,
        TELEGRAM_BOT_TOKEN: "test-telegram-token",
        OPERATIONAL_STATE_DIRECTORY: directory,
      },
      runtimeSessionId: "current-process-session",
      operationalStateStore: currentStore,
      createTelegramOperatorAdapter: ({ operator: suppliedOperator }) => {
        operator = suppliedOperator
        return {
          start: async () => {
            operatorAdapterStarted = true
            return {
              ok: true,
              started: true,
            }
          },
          stop: async () => ({
            ok: true,
            stopped: true,
          }),
        }
      },
    })
    assert.equal(operatorAdapterStarted, true, "The Telegram adapter must start even when process-restart recovery is disabled.")
    assert.equal(runtime.connected, true, "Disabling process-restart recovery must not prevent the broker runtime from connecting.")
    assert.equal(runtime.tradingEnabled, true, "A prior process session must remain external; fresh current-session trading may proceed after PREFLIGHT when restart recovery is disabled.")
    assert.equal(runtime.userDataReady, true, "Fresh current-process user-data readiness must open the trading gate without process-restart recovery.")
    await assertTelegramPauseCommandIsDurable({
      operator,
      operationalStateStore: currentStore,
    })
  } finally {
    await runtime?.stop?.()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
