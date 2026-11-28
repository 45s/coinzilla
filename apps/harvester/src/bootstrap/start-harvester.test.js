import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "../../test/bootstrap/start-harvester-test-support.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { createHarvesterStartupContext } from "./start-harvester.js"
import { recordSafetyBlockerRaised, recordSafetyBlockerResolved } from "../use-cases/record-safety-control-facts.js"
import { authenticateLocalOperator } from "../infrastructure/security/local-operator-identity.js"

const { Balance, CanonicalOrder, Fill, Money, Quantity, TradingRules, multiplyDecimal, waitForTestSignal, appConfig, createMarketMetadata, createOpenOrderSnapshot, createBinanceCapabilities, createBroker, createRecoverySellerStopWorkflow, recordConfigurationBaseline, recordProcessStarted, recordProcessStopped, makeVolatilityReadyBroker, createTwoMarketStartupConfig, binanceEnv, startHarvesterForTest, createFill } = shared
const { mkdtemp, rm, os, path, createFileOperationalStateStore } = shared
const test = (...args) => nodeTest(`[start-harvester.test.js] ${args[0]}`, ...args.slice(1))

async function seedAccountBlockerRestartSession({ store, config, reason = "ACCOUNTING_INTEGRITY_FAILURE" } = {}) {
  const baseline = await recordConfigurationBaseline({
    operationalStateStore: store,
    appConfig: config,
  })
  assert.equal(baseline.ok, true, baseline.errors?.[0]?.message)
  const started = await recordProcessStarted({
    operationalStateStore: store,
    configurationFingerprint: baseline.data.fingerprint,
    strategyName: baseline.data.strategyName,
    markets: baseline.data.markets,
    tradingEnabled: true,
  })
  assert.equal(started.ok, true, started.errors?.[0]?.message)
  const raised = await recordSafetyBlockerRaised({
    operationalStateStore: store,
    producer: "USER_DATA_EVENT_HANDLER",
    scope: "ACCOUNT",
    symbol: null,
    reason,
    evidenceDigest: "a".repeat(64),
  })
  assert.equal(raised.ok, true, raised.errors?.[0]?.message)
  const { blockerId } = raised.data.record.data
  const stopped = await recordProcessStopped({
    operationalStateStore: store,
    reason: "TEST_CLEAN_STOP_AFTER_ACCOUNT_BLOCKER",
    clean: true,
  })
  assert.equal(stopped.ok, true, stopped.errors?.[0]?.message)
  return blockerId
}

async function resolveAccountBlockerOffline({ store, blockerId } = {}) {
  const operatorId = "operator-7"
  const actionId = "account-recovery-action-001"
  const operatorIdentity = authenticateLocalOperator({
    operatorId,
    getUserInfo: () => ({ username: operatorId }),
  })
  const resolved = await recordSafetyBlockerResolved({
    operationalStateStore: store,
    blockerId,
    resolvedBy: `operator:${operatorId}:${actionId}`,
    resolution: "OPERATOR_ACTION",
    evidenceDigest: "b".repeat(64),
    operatorIdentity,
    operatorId,
    actionId,
    resolutionReason: "Verified root cause correction and complete account-wide reconciliation.",
    actionBlockerIds: [blockerId],
  })
  assert.equal(resolved.ok, true, resolved.errors?.[0]?.message)
}

async function createResolvedAccountBlockerRestartStore({ directory, store, config } = {}) {
  const blockerId = await seedAccountBlockerRestartSession({
    store,
    config,
  })
  await resolveAccountBlockerOffline({
    store,
    blockerId,
  })
  return {
    restartStore: createFileOperationalStateStore({
      directory,
      runtimeSessionId: "account-blocker-restart-session",
    }),
    blockerId,
  }
}

async function createRsOnlyOperationalStateStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-rs-only-startup-"))
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "rs-only-startup-session",
  })
  const initialized = await store.initialize()
  assert.equal(initialized.ok, true, "RS-only startup requires an initialized durable operational-state store")
  return {
    directory,
    store,
  }
}

function createRsOnlyStartupBroker({ calls, includeBitcoin = false }) {
  const broker = createBroker(calls)
  const { baseAsset: lineaBaseAsset, quoteAsset } = createMarketMetadata("LINEAUSDT").market
  const { baseAsset: bitcoinBaseAsset } = createMarketMetadata("BTCUSDT").market
  const accountAssets = [...new Map([
    lineaBaseAsset,
    ...(includeBitcoin ? [bitcoinBaseAsset] : []),
    quoteAsset,
  ].map((asset) => [asset.id, asset])).values()]
  let accountSnapshotSourceTime
  broker.getAccountSnapshot = async () => {
    accountSnapshotSourceTime ??= Date.now()
    return {
      ok: true,
      data: {
        sourceTime: accountSnapshotSourceTime,
        balances: accountAssets.map((asset) => new Balance({
          free: new Quantity({
            amount: "100000",
            asset,
          }),
          locked: new Quantity({
            amount: "0",
            asset,
          }),
        })),
      },
    }
  }
  return broker
}

function createRsOnlyStartupConfig({
  enableVolatilityProtection = false,
  processRecoveryEnabled = true,
} = {}) {
  const recoverySellerPair = {
    enabled: true,
    tradingEnvironment: "testnet",
    enableVolatilityProtection,
    legacyPosition: {
      invested: 400,
      quantity: 25000,
    },
    sellQuantity: 10,
    investment: 100,
    orderQuantity: 7000,
    minProfit: 0.01,
    priceStepPercent: 0.5,
    makerPercent: 0.1,
    takerPercent: 0.1,
  }
  return {
    ...appConfig,
    components: { recovery: { enabled: processRecoveryEnabled } },
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        settings: {
          ...appConfig.strategies.CG_coinGrabber.settings,
          recovery: { enabled: processRecoveryEnabled },
        },
      },
      RS_recoverySeller: {
        enabled: true,
        pairs: {
          LINEAUSDT: recoverySellerPair,
        },
      },
    },
  }
}

test("composes the default market-price error handler with resolved RS ownership", async () => {
  const { directory, store } = await createRsOnlyOperationalStateStore()
  const errorRecords = []
  const failure = new Error("RS market price processing failed")
  try {
    const startup = await createHarvesterStartupContext({
      options: {
        loadConfig: async () => createRsOnlyStartupConfig(),
        env: binanceEnv,
        operationalStateStore: store,
        executionSymbols: ["LINEAUSDT"],
        executionRoutes: [{
          strategyId: StrategyId.RECOVERY_SELLER,
          symbol: "LINEAUSDT",
        }],
        eventPublisher: shared.testEventPublisher,
        logger: {
          info() {},
          error: (record) => errorRecords.push(record),
        },
      },
    })

    startup.onMarketPriceError({
      symbol: "LINEAUSDT",
      errors: [failure],
    })

    assert.deepEqual(errorRecords, [{
      message: "Market price processing failed",
      strategyId: StrategyId.RECOVERY_SELLER,
      symbol: "LINEAUSDT",
      error: undefined,
      errors: [failure],
    }], "Bootstrap must pass resolved RS ownership into the default shared market-price error handler.")
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("reports broker connection failure before rethrowing the original startup error", async () => {
  const { directory, store } = await createRsOnlyOperationalStateStore()
  const broker = createRsOnlyStartupBroker({ calls: [] })
  const connectionFailure = new Error("fake broker connection failure")
  broker.connect = async () => {
    throw connectionFailure
  }
  const healthRecords = []
  try {
    await assert.rejects(
      startHarvesterForTest({
        loadConfig: async () => createRsOnlyStartupConfig(),
        env: binanceEnv,
        brokerAdapterFactory: () => broker,
        operationalStateStore: store,
        executionSymbols: ["LINEAUSDT"],
        executionRoutes: [{
          strategyId: "RS_recoverySeller",
          symbol: "LINEAUSDT",
        }],
        marketDataSymbols: ["LINEAUSDT"],
        logger: {
          debug: (record) => healthRecords.push(record),
          info: (record) => healthRecords.push(record),
          warn: (record) => healthRecords.push(record),
          error: (record) => healthRecords.push(record),
          system: (record) => healthRecords.push(record),
        },
      }),
      (error) => error === connectionFailure,
    )
    assert.ok(
      healthRecords.some((record) => record.code === "BROKER_NOT_CONNECTED"),
      "The startup audit must log a specific broker connection failure before aborting.",
    )
    assert.ok(
      healthRecords.some((record) => record.message?.includes("Startup Preflight Summary")),
      "The startup audit must log its terminal summary when broker connection fails.",
    )
  } finally {
    await rm(directory, { recursive: true,
force: true })
  }
})


test("retains CG and RS execution routes and subscriptions when process recovery is disabled", async () => {
  const { directory, store } = await createRsOnlyOperationalStateStore()
  const calls = []
  const broker = createRsOnlyStartupBroker({
    calls,
    includeBitcoin: true,
  })
  try {
    const combinedConfig = createRsOnlyStartupConfig({ processRecoveryEnabled: false })
    combinedConfig.strategies.CG_coinGrabber = {
      ...combinedConfig.strategies.CG_coinGrabber,
      pairs: {
        ...combinedConfig.strategies.CG_coinGrabber.pairs,
        BTCUSDT: {
          ...combinedConfig.strategies.CG_coinGrabber.pairs.BTCUSDT,
          enableVolatilityProtection: false,
        },
      },
    }
    const result = await startHarvesterForTest({
      loadConfig: async () => combinedConfig,
      env: binanceEnv,
      operationalStateStore: store,
      executionSymbols: ["BTCUSDT", "LINEAUSDT"],
      executionRoutes: [
        {
          strategyId: StrategyId.COIN_GRABBER,
          symbol: "BTCUSDT",
        },
        {
          strategyId: StrategyId.RECOVERY_SELLER,
          symbol: "LINEAUSDT",
        },
      ],
      marketDataSymbols: ["BTCUSDT", "LINEAUSDT"],
      brokerAdapterFactory: () => broker,
      eventPublisher: shared.testEventPublisher,
    })

    assert.deepEqual(result.executionRoutes, [
      {
        strategyId: StrategyId.COIN_GRABBER,
        symbol: "BTCUSDT",
      },
      {
        strategyId: StrategyId.RECOVERY_SELLER,
        symbol: "LINEAUSDT",
      },
    ], "The resolved provider runtime must retain both strategy-owned execution routes.")
    assert.ok(calls.includes("subscribe:BTCUSDT"),
      "The CG market-data subscription must remain active when RS is enabled.")
    assert.ok(calls.includes("subscribe:LINEAUSDT"),
      "The RS market-data subscription must be added without replacing the CG subscription.")
    await result.stop()
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("fails RS startup explicitly when its durable Operational State Store is missing", async () => {
  await assert.rejects(
    () => startHarvesterForTest({
      loadConfig: async () => createRsOnlyStartupConfig({ processRecoveryEnabled: false }),
      env: binanceEnv,
      executionSymbols: ["LINEAUSDT"],
      executionRoutes: [{
        strategyId: StrategyId.RECOVERY_SELLER,
        symbol: "LINEAUSDT",
      }],
      marketDataSymbols: ["LINEAUSDT"],
      eventPublisher: shared.testEventPublisher,
    }),
    (error) => {
      assert.equal(error.code, "RECOVERY_SELLER_OPERATIONAL_STATE_STORE_REQUIRED",
        "Missing RS STOP storage must have a stable startup error code.")
      assert.match(error.message, /verified durable Operational State Store/,
        "The startup error must explain the exact missing RS dependency.")
      return true
    },
  )
})

test("fails RS startup explicitly when its Operational State Store is invalid", async () => {
  const { directory, store } = await createRsOnlyOperationalStateStore()
  const invalidStore = {
    append: store.append.bind(store),
    readAll: store.readAll.bind(store),
    verify: async () => ({
      ok: true,
      data: {
        valid: false,
        durableWriteSupported: false,
      },
    }),
  }
  try {
    await assert.rejects(
      () => startHarvesterForTest({
        loadConfig: async () => createRsOnlyStartupConfig({ processRecoveryEnabled: false }),
        env: binanceEnv,
        operationalStateStore: invalidStore,
        executionSymbols: ["LINEAUSDT"],
        executionRoutes: [{
          strategyId: StrategyId.RECOVERY_SELLER,
          symbol: "LINEAUSDT",
        }],
        marketDataSymbols: ["LINEAUSDT"],
        eventPublisher: shared.testEventPublisher,
      }),
      (error) => {
        assert.equal(error.code, "DURABLE_FACTS_VERIFICATION_FAILED",
          "An invalid RS store must preserve the durable verification error code.")
        assert.match(error.message, /unverified ADR-0001 Operational State Store/,
          "An invalid RS store must fail before broker-capable startup.")
        return true
      },
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("starts an RS-only provider account without a Conservative execution route", async () => {
  const { directory, store } = await createRsOnlyOperationalStateStore()
  const calls = []
  const broker = createRsOnlyStartupBroker({ calls })
  try {
    const result = await startHarvesterForTest({
      loadConfig: async () => createRsOnlyStartupConfig({ processRecoveryEnabled: false }),
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      operationalStateStore: store,
      executionSymbols: ["LINEAUSDT"],
      executionRoutes: [{
        strategyId: "RS_recoverySeller",
        symbol: "LINEAUSDT",
      }],
      marketDataSymbols: ["LINEAUSDT"],
      evaluateRecoverySellerTransition: async () => ({
        ok: true,
        data: {
          skipped: true,
        },
      }),
      logger: {
        info() {},
        error() {},
      },
    })

    assert.equal(result.tradingEnabled, true, "The RS-only account must enable its routed strategy execution.")
    assert.deepEqual(result.executionRoutes, [{
      strategyId: "RS_recoverySeller",
      symbol: "LINEAUSDT",
    }], "The account must retain RS ownership without inventing a Conservative route.")
    assert.ok(calls.includes("subscribe:LINEAUSDT"), "The RS-only market must receive its market-data subscription.")
    assert.equal(result.getVolatilityProtectionState({ symbol: "LINEAUSDT" }), undefined, "An RS-only market with volatility disabled must not allocate protection state.")
    await result.stop()
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("keeps startup incomplete and the user-data gate closed until deferred market-data startup succeeds", async () => {
  const { directory, store } = await createRsOnlyOperationalStateStore()
  const calls = []
  const broker = createRsOnlyStartupBroker({ calls })
  let result
  try {
    result = await startHarvesterForTest({
      loadConfig: async () => createRsOnlyStartupConfig({ processRecoveryEnabled: false }),
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      operationalStateStore: store,
      executionSymbols: ["LINEAUSDT"],
      executionRoutes: [{
        strategyId: "RS_recoverySeller",
        symbol: "LINEAUSDT",
      }],
      marketDataSymbols: ["LINEAUSDT"],
      deferMarketDataStart: true,
      evaluateRecoverySellerTransition: async () => ({
        ok: true,
        data: {
            skipped: true,
          },
      }),
      logger: { info() {},
error() {} },
    })

    assert.equal(result.userDataReady, false, "User-data PREFLIGHT must not open trading while market-data startup is deferred.")
    assert.equal(calls.includes("subscribe:LINEAUSDT"), false, "The deferred market-data lifecycle must not start before its explicit continuation.")
    await result.startMarketData()
    assert.equal(result.userDataReady, true, "The existing trading gate may open only after market-data startup and readiness audit succeed.")
    assert.ok(calls.includes("subscribe:LINEAUSDT"), "The explicit continuation must start the configured market-data subscription.")
  } finally {
    await result?.stop()
    await rm(directory, { recursive: true,
force: true })
  }
})

test("starts market-owned volatility history for an RS-only market when market config enables it", async () => {
  const { directory, store } = await createRsOnlyOperationalStateStore()
  const calls = []
  const broker = createRsOnlyStartupBroker({ calls })
  broker.getCandles = async ({ symbol }) => {
    calls.push(`candle-history:${symbol}`)
    return {
      ok: true,
      data: [],
    }
  }
  broker.subscribeForCandles = async ({ symbol }) => {
    calls.push(`candle-subscribe:${symbol}`)
    return {
      ok: true,
      data: {
        unsubscribe: async () => {},
      },
    }
  }
  try {
    const result = await startHarvesterForTest({
      loadConfig: async () => createRsOnlyStartupConfig({ enableVolatilityProtection: true }),
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      operationalStateStore: store,
      executionSymbols: ["LINEAUSDT"],
      executionRoutes: [{
        strategyId: "RS_recoverySeller",
        symbol: "LINEAUSDT",
      }],
      marketDataSymbols: ["LINEAUSDT"],
      evaluateRecoverySellerTransition: async () => ({
        ok: true,
        data: { skipped: true },
      }),
      logger: {
        info() {},
        error() {},
      },
    })

    assert.ok(calls.includes("candle-subscribe:LINEAUSDT"), "Volatility candle subscription must follow market config, not CG ownership.")
    assert.ok(calls.includes("candle-history:LINEAUSDT"), "Volatility history warm-up must run for an RS-only market with protection enabled.")
    assert.equal(result.getVolatilityProtectionState({ symbol: "LINEAUSDT" })?.mode, "PROTECTED", "Enabled market volatility state must initialize independently of CG strategy ownership.")
    await result.stop()
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

async function startHarvesterWithExternalClosingSell({ calls, publishedEvents }) {
  const externalSell = {
    id: "manual-closing-sell",
    symbol: "BTCUSDT",
    side: "SELL",
    type: "LIMIT",
    originalPrice: "65000",
    originalQuantity: "0.01",
    executedQuantity: "0",
    status: "NEW",
    clientOrderId: "manual-closing-sell-client",
  }
  const broker = createBroker(calls, {
    externalOpenOrders: [externalSell],
  })
  const originalGetOpenOrders = broker.getOpenOrders.bind(broker)
  let openOrderReads = 0
  broker.getOpenOrders = async (options = {}) => {
    openOrderReads += 1
    calls.push(`open-orders:${openOrderReads}:${options.symbol ?? "account"}`)
    return originalGetOpenOrders(options)
  }
  const originalCancelOrder = broker.cancelOrder.bind(broker)
  broker.cancelOrder = async (...args) => {
    calls.push("cancel-order")
    return originalCancelOrder(...args)
  }
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => {
        publishedEvents.push(event)
        return { ok: true }
      },
      flush: async () => ({
        ok: true,
        durable: true,
      }),
      flushWrites: async () => ({
        ok: true,
        durable: true,
      }),
    },
    logger: {
      info() {},
      error() {},
    },
  })
  return {
    result,
    getOpenOrderReads: () => openOrderReads,
  }
}

test("captures the CLOSING account-wide open-order set before broker disconnect without mutating external SELLs", async () => {
  const calls = []
  const publishedEvents = []
  const fixture = await startHarvesterWithExternalClosingSell({
    calls,
    publishedEvents,
  })

  await fixture.result.stop()

  const openOrderEvents = publishedEvents.filter((event) => event.name === "account.open_orders_captured")
  const closingOpenOrders = openOrderEvents.find((event) => event.data.phase === "CLOSING")
  const closingBalances = publishedEvents.find((event) =>
    event.name === "account.snapshot_captured" && event.data.phase === "CLOSING")
  assert.ok(closingOpenOrders, "The runtime must publish a CLOSING account-wide open-order event.")
  assert.ok(closingBalances, "The runtime must publish a CLOSING balance event.")
  assert.equal(closingOpenOrders.data.readiness, "BLOCKED", "The external SELL remains unowned rather than being adopted.")
  assert.deepEqual(closingOpenOrders.data.orders.map(({ brokerOrderId, clientOrderId, side }) => ({
    brokerOrderId,
    clientOrderId,
    side,
  })), [{
    brokerOrderId: "manual-closing-sell",
    clientOrderId: "manual-closing-sell-client",
    side: "SELL",
  }])
  assert.equal(closingBalances.data.auditStatus, "COMPLETE", "An observed external order does not make the balance audit incomplete.")
  assert.ok(
    publishedEvents.indexOf(closingOpenOrders) < publishedEvents.indexOf(closingBalances),
    "CLOSING open-order evidence must be durably published before the CLOSING balance audit.",
  )
  assert.equal(calls.includes("cancel-order"), false, "The external recovery SELL must remain untouched.")
  assert.ok(fixture.getOpenOrderReads() >= 2, "The runtime must perform the startup audit and a separate CLOSING read.")
  assert.ok(calls.lastIndexOf(`open-orders:${fixture.getOpenOrderReads()}:account`) < calls.indexOf("disconnect"))
})


function createTwoMarketShutdownEventPublisher({ calls, publishedEvents } = {}) {
  let lastPublishedEvent
  let failNextFlush = false
  return {
    publish(event) {
      publishedEvents.push(event)
      lastPublishedEvent = event
      if (event.name === "account.open_orders_captured" && event.data.phase === "CLOSING") {
        calls.push("closing-open-orders")
      }
      if (event.name === "account.snapshot_captured" && event.data.phase === "CLOSING") {
        calls.push("closing-balances")
      }
      return { ok: true }
    },
    failNextFlush() {
      failNextFlush = true
    },
    flushWrites: async () => ({
      ok: true,
      durable: true,
    }),
    flush: async () => {
      if (failNextFlush) {
        failNextFlush = false
        calls.push("journal-flush-failed")
        return {
          ok: false,
          durable: false,
          errors: [new Error("Journal fsync failed")],
        }
      }
      calls.push(["flush", lastPublishedEvent?.name ?? "undefined", lastPublishedEvent?.data?.phase ?? ""].join(":"))
      return {
        ok: true,
        durable: true,
      }
    },
  }
}

function createTwoMarketShutdownLogger({ calls, infoRecords } = {}) {
  return {
    info(record) {
      infoRecords.push(record)
      if (record.message === "Conservative market is safe to shut down") {
        calls.push(["safe", record.symbol].join(":"))
      }
    },
    error(record) {
      infoRecords.push(record)
    },
  }
}

function assertShutdownBarrierBeforeMarketStop({ calls, barrier, firstMarketFeedStopIndex, message } = {}) {
  const barrierIndex = calls.indexOf(barrier)
  assert.ok(barrierIndex >= 0 && barrierIndex < firstMarketFeedStopIndex, message)
}

function assertTwoMarketShutdownAcceptance({ calls, infoRecords, publishedEvents, stopResult, processHistory }) {
  assert.equal(stopResult.ok, true, "The composed runtime must complete every required teardown phase.")
  assert.equal(stopResult.status, "STOPPED", "The composed runtime must return the explicit STOPPED outcome.")
  const safeSymbols = [...new Set(infoRecords
    .filter((record) => record.message === "Conservative market is safe to shut down")
    .map((record) => record.symbol))].sort()
  assert.deepEqual(safeSymbols, ["BTCUSDT", "ETHUSDT"], "Every enabled market must independently prove shutdown safety.")

  const marketFeedStopIndexes = ["BTCUSDT", "ETHUSDT"].map((symbol) => calls.indexOf(["unsubscribe", symbol].join(":")))
  assert.ok(marketFeedStopIndexes.every((index) => index >= 0), "Every enabled market feed must be stopped.")
  const firstMarketFeedStopIndex = Math.min(...marketFeedStopIndexes)
  for (const symbol of ["BTCUSDT", "ETHUSDT"]) {
    assert.ok(calls.indexOf(["safe", symbol].join(":")) < firstMarketFeedStopIndex, "Every market must be safe before any market feed is stopped.")
  }

  const closingOpenOrders = publishedEvents.find((event) => event.name === "account.open_orders_captured" && event.data.phase === "CLOSING")
  const closingBalances = publishedEvents.find((event) => event.name === "account.snapshot_captured" && event.data.phase === "CLOSING")
  assert.ok(closingOpenOrders && closingBalances, "The composed runtime must publish both CLOSING account audits.")
  assert.ok(publishedEvents.indexOf(closingOpenOrders) < publishedEvents.indexOf(closingBalances), "CLOSING open orders must precede CLOSING balances.")
  assertShutdownBarrierBeforeMarketStop({
    calls,
    barrier: "flush:account.open_orders_captured:CLOSING",
    firstMarketFeedStopIndex,
    message: "The CLOSING open-order durability barrier must precede market teardown.",
  })
  assertShutdownBarrierBeforeMarketStop({
    calls,
    barrier: "flush:account.snapshot_captured:CLOSING",
    firstMarketFeedStopIndex,
    message: "The CLOSING balance durability barrier must precede market teardown.",
  })

  const userDataStopIndex = calls.indexOf("unsubscribe:user-data")
  const brokerDisconnectIndex = calls.indexOf("disconnect")
  assert.ok(marketFeedStopIndexes.every((index) => index < userDataStopIndex), "All market feeds must stop before shared user-data intake.")
  assert.ok(userDataStopIndex >= 0 && userDataStopIndex < brokerDisconnectIndex, "User-data intake must stop before broker disconnect.")
  assert.equal(processHistory.ok, true, "The durable process-state history must remain readable.")
  assert.equal(processHistory.data.records.filter((record) => record.factType === "PROCESS_STOPPED").length, 1, "Successful teardown must append exactly one durable PROCESS_STOPPED fact.")
}

test("proves shutdown safety independently for every enabled market in the composed runtime", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-multimarket-shutdown-"))
  const operationalStateStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "multimarket-shutdown-acceptance",
  })
  const initialized = await operationalStateStore.initialize()
  assert.equal(initialized.ok, true, "The durable process-state fixture must initialize.")
  const calls = []
  const publishedEvents = []
  const infoRecords = []
  const eventPublisher = createTwoMarketShutdownEventPublisher({
    calls,
    publishedEvents,
  })
  const broker = makeVolatilityReadyBroker(createBroker(calls), ["BTCUSDT", "ETHUSDT"])

  try {
    const runtime = await startHarvesterForTest({
      loadConfig: async () => createTwoMarketStartupConfig(),
      env: binanceEnv,
      operationalStateStore,
      brokerAdapterFactory: () => broker,
      eventPublisher,
      logger: createTwoMarketShutdownLogger({
        calls,
        infoRecords,
      }),
    })
    const stopResult = await runtime.stop()
    const processHistory = await operationalStateStore.readAll()
    assertTwoMarketShutdownAcceptance({
      calls,
      infoRecords,
      publishedEvents,
      stopResult,
      processHistory,
    })
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("fails closed before teardown when composed Journal durability cannot be proven", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-multimarket-journal-failure-"))
  const operationalStateStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "multimarket-journal-failure",
  })
  const initialized = await operationalStateStore.initialize()
  assert.equal(initialized.ok, true, "The durable process-state fixture must initialize.")
  const calls = []
  const publishedEvents = []
  const infoRecords = []
  const eventPublisher = createTwoMarketShutdownEventPublisher({
    calls,
    publishedEvents,
  })
  const broker = makeVolatilityReadyBroker(createBroker(calls), ["BTCUSDT", "ETHUSDT"])

  try {
    const runtime = await startHarvesterForTest({
      loadConfig: async () => createTwoMarketStartupConfig(),
      env: binanceEnv,
      operationalStateStore,
      brokerAdapterFactory: () => broker,
      eventPublisher,
      logger: createTwoMarketShutdownLogger({
        calls,
        infoRecords,
      }),
    })
    eventPublisher.failNextFlush()
    await assert.rejects(runtime.stop())
    assert.ok(calls.includes("journal-flush-failed"), "The injected Journal durability failure must be observed.")
    for (const symbol of ["BTCUSDT", "ETHUSDT"]) {
      assert.equal(calls.includes(`unsubscribe:${symbol}`), false, "A market feed must remain connected after failed Journal durability.")
    }
    assert.equal(calls.includes("unsubscribe:user-data"), false, "User-data intake must remain connected after failed Journal durability.")
    assert.equal(calls.includes("disconnect"), false, "The broker must remain connected after failed Journal durability.")
    const processHistory = await operationalStateStore.readAll()
    assert.equal(processHistory.ok, true, "The durable process-state history must remain readable.")
    assert.equal(processHistory.data.records.some((record) => record.factType === "PROCESS_STOPPED"), false, "Failed shutdown must never append PROCESS_STOPPED.")
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("blocks trading after execution accounting failure", async () => {
  const broker = createBroker()
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    onUserDataEvent: async () => {},
    logger: {
      info() {},
      error() {}
    },
  })
  await broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    fill: createFill({ tradeId: "trade-2" }),
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(result.userDataReady, false, "Execution-accounting failure gate: expected result.userDataReady to equal false.")
  assert.equal(result.userDataStatus, "EXECUTION_ACCOUNTING_FAILED", "Execution-accounting failure gate: expected result.userDataStatus to equal \"EXECUTION_ACCOUNTING_FAILED\".")
  assert.equal(result.placeOrder, undefined, "Execution-accounting failure gate: expected result.placeOrder to equal undefined.")
  assert.equal(result.broker, undefined, "Execution-accounting failure gate: expected result.broker to equal undefined.")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "Execution-accounting failure gate: expected result.stop() to reject or throw with /Harvester shutdown was incomplete/.")
})

test("fails startup before opening streams when required minimum notional is unavailable", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.getSymbolFilters = async ({ symbol }) => {
    calls.push(`filters:${  symbol}`)
    const metadata = createMarketMetadata(symbol)
    return {
      ok: true,
      data: {
        ...metadata,
        tradingRules: new TradingRules({
          market: metadata.market,
          constraints: metadata.tradingRules.constraints.filter(
            ({ type }) => type !== "MIN_NOTIONAL",
          ),
        }),
      },
    }
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
    /Required exchange trading rule is unavailable: MIN_NOTIONAL/, "Minimum-notional startup validation: expected startHarvesterForTest({\n      loadConfig: async () => appConfig,\n      env: binanceEnv,\n      brokerAdapterFactory: () => broker,\n      logger: {\n        info() {},\n        error() {}\n      },\n    }) to reject or throw with /Required exchange trading rule is unavailable: MIN_NOTIONAL/."
  )
  assert.deepEqual(calls, ["connect", "filters:BTCUSDT", "disconnect"], "Minimum-notional startup validation: expected calls to deeply equal [\"connect\", \"filters:BTCUSDT\", \"disconnect\"].")
})

class TestnetTradingRecoveryScenario {
  createBrokerPart1() {
    return {
      connect: async () => this.calls.push("connect"),
      disconnect: async () => this.calls.push("disconnect"),
      getExchangeMarkets: async () => ({
        ok: true,
        data: []
      }),
      getSymbolFilters: async () => ({
        ok: true,
        data: this.marketMetadata
      }),
      getOpenOrders: async ({ symbol } = {}) => {
        if (this.recoveryPending) {
          if (symbol) {
            this.recoveryOwnedOpenOrderReads += 1
          } else {
            this.recoveryAccountWideOpenOrderReads += 1
          }
        }
        return {
          ok: true,
          data: [...this.canonicalOrdersByBrokerId.values()]
            .filter((order) => ["OPEN", "PARTIALLY_FILLED"].includes(order.status))
            .filter((order) => !symbol || order.market.symbol === symbol)
            .map((order) => createOpenOrderSnapshot({ order })),
        }
      },
      getPrices: async () => ({
        ok: true,
        data: {
        symbol: "BTCUSDT",
        price: "65000"
      }
      }),
      getCandles: async () => ({
        ok: true,
        data: []
      }),
      subscribeForCandles: async () => ({
        ok: true,
        data: { unsubscribe: async () => {} }
      }),
    }
  }

  createBrokerPart2() {
    return {
      cancelOrder: async ({ order }) => {
        if (order.side === "BUY") {this.buyCancellationCount.value += 1}
        const canceledOrder = new CanonicalOrder({
          clientOrderId: order.clientOrderId,
          brokerOrderId: order.brokerOrderId,
          market: order.market,
          side: order.side,
          type: order.type,
          limitPrice: order.limitPrice,
          originalQuantity: order.originalQuantity,
          executedQuantity: order.executedQuantity,
          status: "CANCELED",
          createdAt: order.createdAt,
          acknowledgedAt: order.acknowledgedAt,
          updatedAt: 3,
          completedAt: 3,
        })
        this.canonicalOrdersByBrokerId.set(order.brokerOrderId, canceledOrder)
        return {
          ok: true,
          data: canceledOrder
        }
      },
      getFills: async ({ orderId } = {}) => {
        if (this.recoveryPending) {this.recoveryFillHistoryReads += 1}
        return {
          ok: true,
          data: this.fillHistoryByOrder.get(String(orderId)) ?? []
        }
      },
      getCanonicalOrderHistory: async ({
        orderId,
        symbol
      } = {}) => {
        if (this.recoveryPending) {
          this.recoveryCanonicalHistoryReads += 1
          if (this.recoveryCanonicalHistoryReads === 1) {
            this.resolveRecoveryHistoryStarted()
            await this.recoveryHistoryGate
          }
        }
        return {
          ok: true,
          data: [...this.canonicalOrdersByBrokerId.values()].filter((order) =>
            (!orderId || order.brokerOrderId === String(orderId)) &&
            (!symbol || order.market.symbol === symbol)),
        }
      },
      getCanonicalOrder: async () => ({
        ok: false,
        errors: [new Error("order not found")]
      }),
    }
  }

  createBrokerPart3() {
    return {
      getAccountSnapshot: async () => {
        if (this.recoveryPending) {this.recoveryAccountSnapshotReads += 1}
        this.snapshotTime += 1
        const balances = [
          new Balance({
            free: new Quantity({
              amount: this.baseBalance,
              asset: this.marketMetadata.market.baseAsset
            }),
            locked: new Quantity({
              amount: "0",
              asset: this.marketMetadata.market.baseAsset
            }),
          }),
          new Balance({
            free: new Quantity({
              amount: "10000",
              asset: this.marketMetadata.market.quoteAsset
            }),
            locked: new Quantity({
              amount: "0",
              asset: this.marketMetadata.market.quoteAsset
            }),
          }),
        ]
        return {
          ok: true,
          data: {
          balances,
          sourceTime: this.snapshotTime
        }
        }
      },
    }
  }

  createBrokerPart4() {
    return {
      subscribeForUserData: async (handlers) => {
        this.userDataHandlers = {
          ...handlers,
          onEvent: (message) => {
            const event = message?.event
            const executedOrder = event?.executedOrder
            if (executedOrder?.brokerOrderId) {
              this.canonicalOrdersByBrokerId.set(executedOrder.brokerOrderId, executedOrder)
            }
            const fill = event?.fill
            if (fill instanceof Fill) {
              const existing = this.fillHistoryByOrder.get(fill.brokerOrderId) ?? []
              if (!existing.some((item) => item.id === fill.id)) {
                this.fillHistoryByOrder.set(fill.brokerOrderId, [...existing, fill])
              }
            }
            return handlers.onEvent(message)
          },
        }
        return {
          ok: true,
          data: {
            disconnect: async () => this.calls.push("unsubscribe:user-data"),
            acknowledgeRecoveryResult: (recoveryGeneration) => {
              assert.equal(
                recoveryGeneration,
                1,
                "The recovery integration fixture must acknowledge the broker generation it reconciled.",
              )
              this.recoveryAcknowledgementCount += 1
              this.recoveryAcknowledgementObservation = {
                queuedFillProcessedCount: this.recoveryQueuedFillProcessedCount,
                queuedFillMode: this.recoveryQueuedFillMode,
                fillAppliedCount: this.publishedEvents.filter((event) =>
                  event.name === "execution.fill_applied" && event.data?.tradeId === this.recoveryFillTradeId).length,
                accountAuditDurable: this.durableFlushes.some((flush) =>
                  flush.some((event) => event.name === "account.snapshot_captured" && event.phase === "RECOVERY")),
                openOrdersAuditDurable: this.durableFlushes.some((flush) =>
                  flush.some((event) => event.name === "account.open_orders_captured" && event.phase === "RECOVERY")),
              }
              handlers.onStatus({
                type: "reconciled",
                subscriptionId: 17,
                recoveryGeneration: 1,
                recoveryRequired: false,
                reconciliationRequired: false,
              })
              this.resolveRecoveryAcknowledged()
              return {
                accepted: true,
                completed: true
              }
            },
          },
        }
      },
    }
  }

  createBrokerPart5() {
    return {
      subscribeForPrices: async ({
        symbol,
        onPrice
      }) => {
        this.subscriptions.set(symbol, onPrice)
        return {
          ok: true,
          data: { unsubscribe: async () => this.calls.push(`unsubscribe:${  symbol}`) }
        }
      },
      subscribeForBookTicker: async ({
        symbol,
        onBookTicker
      }) => {
        this.bookSubscriptions.set(symbol, onBookTicker)
        return {
          ok: true,
          data: { unsubscribe: async () => this.calls.push(`unsubscribe:book:${  symbol}`) }
        }
      },
    }
  }

  createBrokerPart6() {
    return {
      placeOrder: async ({ order }) => {
        this.calls.push({
          side: order.side,
          price: order.price,
          quantity: order.quantity
        })
        this.submittedOrders.push(order)
        if (this.submittedOrders.length === 2) {this.resolveTwoOrders()}
        const acknowledgedOrder = new CanonicalOrder({
            clientOrderId: order.clientOrderId,
            brokerOrderId: `broker-${  order.clientOrderId}`,
            market: this.marketMetadata.market,
            side: order.side,
            type: order.type,
            limitPrice: new Money({
              amount: order.price,
              asset: this.marketMetadata.market.quoteAsset
            }),
            originalQuantity: new Quantity({
              amount: order.quantity,
              asset: this.marketMetadata.market.baseAsset
            }),
            executedQuantity: new Quantity({
              amount: "0",
              asset: this.marketMetadata.market.baseAsset
            }),
            status: "OPEN",
            createdAt: 1,
            acknowledgedAt: 1,
            updatedAt: 1,
          })
        this.canonicalOrdersByBrokerId.set(acknowledgedOrder.brokerOrderId, acknowledgedOrder)
        return {
          ok: true,
          data: acknowledgedOrder
        }
      },
    }
  }

  resetStep1ProcessState() {
        this.calls = []
        this.buyCancellationCount = { value: 0 }
        this.subscriptions = new Map()
        this.bookSubscriptions = new Map()
        this.userDataHandlers = undefined
        this.snapshotTime = 0
        this.baseBalance = "0"
        this.signalRecoveryCompleted = undefined
        this.recoveryCompleted = new Promise((resolve) => { this.signalRecoveryCompleted = resolve })
        this.submittedOrders = []
        this.canonicalOrdersByBrokerId = new Map()
        this.fillHistoryByOrder = new Map()
        this.runtimeErrors = []
        this.runtimeDebug = []
        this.runtimeInfo = []
        this.publishedEvents = []
        this.durableFlushes = []
  }

  resetStep1RecoveryState() {
        this.recoveryFillTradeId = "testnet-buy-fill"
        this.recoveryPending = false
        this.recoveryCanonicalHistoryReads = 0
        this.recoveryFillHistoryReads = 0
        this.recoveryAccountWideOpenOrderReads = 0
        this.recoveryOwnedOpenOrderReads = 0
        this.recoveryAccountSnapshotReads = 0
        this.recoveryAcknowledgementCount = 0
        this.recoveryQueuedFillProcessedCount = 0
        this.recoveryQueuedFillMode = undefined
        this.recoveryAcknowledgementObservation = undefined
        this.resolveRecoveryHistoryStarted = undefined
        this.releaseRecoveryHistory = undefined
        this.resolveRecoveryQueuedFillProcessed = undefined
        this.resolveRecoveryAcknowledged = undefined
  }

  resetStep1State() {
    this.resetStep1ProcessState()
    this.resetStep1RecoveryState()
  }
  initializeStep1RecoveryHistoryGate() {
    this.recoveryHistoryStarted = new Promise((resolve) => {
      this.resolveRecoveryHistoryStarted = resolve
    })
  }

  async runStep1() {
    this.resetStep1State()
    this.initializeStep1RecoveryHistoryGate()
  }

  async runStep2() {
    this.recoveryHistoryGate = new Promise((resolve) => {
      this.releaseRecoveryHistory = resolve
    })
  
    this.recoveryQueuedFillProcessed = new Promise((resolve) => {
      this.resolveRecoveryQueuedFillProcessed = resolve
    })
  
    this.recoveryAcknowledged = new Promise((resolve) => {
      this.resolveRecoveryAcknowledged = resolve
    })
  
    this.resolveTwoOrders = undefined
    this.twoOrdersSubmitted = new Promise((resolve) => { this.resolveTwoOrders = resolve })
  
    this.marketMetadata = createMarketMetadata("BTCUSDT")
  
    this.broker = Object.assign(
      { capabilities: createBinanceCapabilities() },
      this.createBrokerPart1(),
      this.createBrokerPart2(),
      this.createBrokerPart3(),
      this.createBrokerPart4(),
      this.createBrokerPart5(),
      this.createBrokerPart6(),
    )
    makeVolatilityReadyBroker(this.broker, ["BTCUSDT"])
  
    this.config = {
      strategies: {
        CG_coinGrabber: {
          enabled: true,
          settings: {
            conservative: { enabled: true },
            aggressive: { enabled: false }
          },
          pairs: {
        BTCUSDT: {
          enabled: true,
            tradingEnvironment: "both",
            enableVolatilityProtection: true,
          investment: 2000,
          orderQuantity: 0.01,
          keepQuantity: 0.001,
          minProfit: 0.01,
          priceStepPercent: 0.05,
          pricePrecision: 2,
          quantityPrecision: 3,
          makerPercent: 0,
          takerPercent: 0,
          },
        },
      },
      },
    }
  
  }

  async runStep3() {
    this.runtime = await startHarvesterForTest({
      loadConfig: async () => this.config,
      env: {
        NODE_ENV: "development",
        BINANCE_API_KEY: "test-key",
        BINANCE_API_SECRET_KEY: "test-secret",
      },
      brokerAdapterFactory: () => this.broker,
      eventPublisher: {
        publish: (event) => {
          this.publishedEvents.push(event)
          if (event.name === "recovery.cycle_completed") {this.signalRecoveryCompleted()}
          return { ok: true }
        },
        flush: async () => {
          this.durableFlushes.push(this.publishedEvents.map((event) => ({
            name: event.name,
            phase: event.data?.phase,
          })))
          return {
            ok: true,
            durable: true
          }
        },
      },
      onUserDataEvent: async ({
        event,
        recoveryMode
      }) => {
        if (event?.fill?.tradeId === this.recoveryFillTradeId) {
          this.recoveryQueuedFillProcessedCount += 1
          this.recoveryQueuedFillMode = recoveryMode
          this.resolveRecoveryQueuedFillProcessed()
        }
      },
      now: () => 1000,
      logger: {
        info: (entry) => this.runtimeInfo.push(entry),
        debug: (entry) => this.runtimeDebug.push(entry),
        error: (entry) => this.runtimeErrors.push({
          message: entry.message,
          symbol: entry.symbol,
          reason: entry.reason,
          errors: entry.errors?.map((error) => error.message ?? String(error))
        }),
      },
    })
  
    assert.equal(this.runtime.userDataReady, true, "TESTNET conservative recovery-cycle scenario: expected this.runtime.userDataReady to equal true.")
  
    this.readinessTransitions = [this.runtime.userDataReady]
  
    this.recordReadinessTransition = () => {
      const ready = this.runtime.userDataReady
      if (this.readinessTransitions[this.readinessTransitions.length - 1] !== ready) {
        this.readinessTransitions.push(ready)
      }
    }
  
    assert.equal(this.submittedOrders.length, 0, "the initial ticker snapshot must wait for a book ticker")
  
  }

  async runStep4() {
    await this.bookSubscriptions.get("BTCUSDT")({
      symbol: "BTCUSDT",
      bestBidPrice: "60000",
      bestBidQuantity: "1",
      bestAskPrice: "70000",
      bestAskQuantity: "1",
      timestamp: 1000,
    })
  
    assert.equal(this.submittedOrders.length, 1, "a fresh non-crossing book should release the initial BUY")
  
    assert.equal(this.submittedOrders[0].side, "BUY", "TESTNET conservative recovery-cycle scenario: expected this.submittedOrders[0].side to equal \"BUY\".")
  
  
    const acknowledgedBuy = new CanonicalOrder({
      clientOrderId: this.submittedOrders[0].clientOrderId,
      brokerOrderId: `broker-${  this.submittedOrders[0].clientOrderId}`,
      market: this.marketMetadata.market,
      side: "BUY",
      type: "LIMIT_MAKER",
      limitPrice: new Money({
        amount: this.submittedOrders[0].price,
        asset: this.marketMetadata.market.quoteAsset
      }),
      originalQuantity: new Quantity({
        amount: this.submittedOrders[0].quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      executedQuantity: new Quantity({
        amount: "0",
        asset: this.marketMetadata.market.baseAsset
      }),
      status: "OPEN",
      createdAt: 1,
      acknowledgedAt: 1,
      updatedAt: 1,
    })
  
    this.userDataHandlers.onEvent({
      event: {
        eventType: "executionReport",
        executionType: "NEW",
        executedOrder: acknowledgedBuy,
      },
    })
  
    await new Promise((resolve) => setImmediate(resolve))
  
    this.acceptedOrderLog = this.runtimeInfo.find(({ orderLifecycle, lifecycleStatus, clientOrderId }) =>
      orderLifecycle === true &&
      lifecycleStatus === "ACCEPTED" &&
      clientOrderId === acknowledgedBuy.clientOrderId)
  
    assert.ok(this.acceptedOrderLog, "TESTNET conservative recovery-cycle scenario: expected this.acceptedOrderLog to be truthy.")
  
    assert.equal(this.acceptedOrderLog.price, this.submittedOrders[0].price, "TESTNET conservative recovery-cycle scenario: expected this.acceptedOrderLog.price to equal this.submittedOrders[0].price.")
  
    assert.equal(this.acceptedOrderLog.quantity, this.submittedOrders[0].quantity, "TESTNET conservative recovery-cycle scenario: expected this.acceptedOrderLog.quantity to equal this.submittedOrders[0].quantity.")
  
  
    this.submitted = this.calls.find((call) => typeof call === "object")
  
    this.clientOrderId = this.submittedOrders[0].clientOrderId
  
  }

  async runStep5() {
    this.canonicalBuy = new CanonicalOrder({
      clientOrderId: this.clientOrderId,
      brokerOrderId: `broker-${  this.clientOrderId}`,
      market: this.marketMetadata.market,
      side: "BUY",
      type: "LIMIT_MAKER",
      limitPrice: new Money({
        amount: this.submitted.price,
        asset: this.marketMetadata.market.quoteAsset
      }),
      originalQuantity: new Quantity({
        amount: this.submitted.quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      executedQuantity: new Quantity({
        amount: this.submitted.quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      status: "FILLED",
      createdAt: 1,
      acknowledgedAt: 1,
      updatedAt: 2,
      completedAt: 2,
    })
  
    this.initialBuyFill = new Fill({
      tradeId: "testnet-buy-fill",
      brokerOrderId: this.canonicalBuy.brokerOrderId,
      clientOrderId: this.canonicalBuy.clientOrderId,
      market: this.marketMetadata.market,
      side: "BUY",
      price: new Money({
        amount: this.submitted.price,
        asset: this.marketMetadata.market.quoteAsset
      }),
      quantity: new Quantity({
        amount: this.submitted.quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      quoteQuantity: new Money({
        amount: "649.6761",
        asset: this.marketMetadata.market.quoteAsset,
      }),
      commissions: [],
      commissionStatus: "COMPLETE",
    })
  
    this.recoveryPending = true
  
    this.userDataHandlers.onStatus({
      type: "recovered",
      subscriptionId: 17,
      recoveryGeneration: 1,
      recoveryRequired: true,
      reconciliationRequired: true,
    })
  
    this.recordReadinessTransition()
  
  }

  async runStep6() {
    await waitForTestSignal(
      this.recoveryHistoryStarted,
      "owned BUY canonical history read during application recovery",
      () => ({
        recoveryCanonicalHistoryReads: this.recoveryCanonicalHistoryReads,
        recoveryAcknowledgementCount: this.recoveryAcknowledgementCount,
        userDataReady: this.runtime.userDataReady,
      }),
      2_000,
    )
  
  
    this.recoveryReminderCount = 254
  
    for (let reminderNumber = 0; reminderNumber < this.recoveryReminderCount; reminderNumber += 1) {
      this.userDataHandlers.onStatus({
        type: "recovered",
        subscriptionId: 17,
        recoveryGeneration: 1,
        recoveryRequired: true,
        reconciliationRequired: true,
      })
      this.recordReadinessTransition()
    }
  
  
    assert.equal(
      this.recoveryCanonicalHistoryReads,
      1,
      "All 254 reminders must share one in-flight owned-order reconciliation instead of starting duplicate canonical-history reads.",
    )
  
    assert.equal(
      this.recoveryAcknowledgementCount,
      0,
      "The broker must not be acknowledged while the owned BUY canonical-history read is unresolved.",
    )
  
    assert.equal(
      this.runtime.userDataReady,
      false,
      "Trading readiness must remain closed throughout the pending recovery generation.",
    )
  
  
    this.baseBalance = "0.01"
  
    this.queuedFillDelivery = this.userDataHandlers.onEvent({
      event: {
        eventType: "executionReport",
        executionType: "TRADE",
        executedOrder: this.canonicalBuy,
        fill: this.initialBuyFill,
      },
    })
  
  }

  async runStep7() {
  
    assert.equal(
      this.recoveryQueuedFillProcessedCount,
      0,
      "The BUY execution report must remain queued while owned-order REST reconciliation is pending.",
    )
  
    assert.equal(
      this.recoveryAcknowledgementCount,
      0,
      "Repeated recovery reminders and a queued fill must not trigger premature broker acknowledgement.",
    )
  
  
    this.releaseRecoveryHistory()
  
    await waitForTestSignal(
      this.recoveryAcknowledged,
      "one successful global broker recovery acknowledgement",
      () => ({
        recoveryCanonicalHistoryReads: this.recoveryCanonicalHistoryReads,
        recoveryAcknowledgementCount: this.recoveryAcknowledgementCount,
        recoveryQueuedFillProcessedCount: this.recoveryQueuedFillProcessedCount,
        userDataReady: this.runtime.userDataReady,
      }),
      5_000,
    )
  
    this.recordReadinessTransition()
  
    await waitForTestSignal(
      this.recoveryQueuedFillProcessed,
      "queued BUY fill drained during application recovery",
      () => ({
        recoveryQueuedFillProcessedCount: this.recoveryQueuedFillProcessedCount,
        recoveryQueuedFillMode: this.recoveryQueuedFillMode,
        userDataReady: this.runtime.userDataReady,
      }),
      2_000,
    )
  
    await this.queuedFillDelivery
  
    this.recoveryPending = false
  
  
    this.recoveryFillAppliedEvents = this.publishedEvents.filter((event) =>
      event.name === "execution.fill_applied" && event.data?.tradeId === this.recoveryFillTradeId)
  
    this.recoveryReconciledStatusEvents = this.publishedEvents.filter((event) =>
      event.name === "broker.status_changed" && event.data?.status === "reconciled")
  
    this.recoveryCompletionLogs = this.runtimeInfo.filter((entry) =>
      entry.message === "application recovery completed and broker acknowledgement accepted")
  
  
    assert.equal(
      this.recoveryReminderCount,
      254,
      "The regression must reproduce the 254 recovered reminders recorded in the incident Journal.",
    )
  
  }

  async runStep8() {
    assert.equal(
      this.recoveryCanonicalHistoryReads,
      1,
      "One unresolved recovery generation must reconcile its owned BUY exactly once despite all repeated reminders.",
    )
  
    assert.ok(
      this.recoveryFillHistoryReads >= 1,
      "Recovery must consult canonical fill history for the owned BUY before certifying reconciliation.",
    )
  
    assert.equal(
      this.recoveryOwnedOpenOrderReads,
      1,
      "Owned-order reconciliation must perform one symbol-scoped open-order read for the single owned BUY.",
    )
  
    assert.equal(
      this.recoveryAccountWideOpenOrderReads,
      1,
      "The recovery generation must perform exactly one account-wide open-orders audit.",
    )
  
    assert.equal(
      this.recoveryAccountSnapshotReads,
      1,
      "The recovery generation must perform exactly one fresh account snapshot read.",
    )
  
    assert.equal(
      this.recoveryQueuedFillProcessedCount,
      1,
      "The queued BUY execution report must be drained once rather than replayed for each recovered reminder.",
    )
  
    assert.equal(
      this.recoveryQueuedFillMode,
      true,
      "The queued BUY execution report must be processed in recovery mode.",
    )
  
    assert.equal(
      this.recoveryFillAppliedEvents.length,
      1,
      "The stream fill and matching REST fill history must update accounting exactly once.",
    )
  
    assert.equal(
      this.runtime.portfolio.getPosition({ symbol: "BTCUSDT" })?.baseQuantity.amount,
      "0.01",
      "The Portfolio must contain exactly one executed BUY quantity after stream/REST overlap.",
    )
  
    assert.equal(
      this.recoveryAcknowledgementCount,
      1,
      "The broker recovery acknowledgement result must be accepted exactly once for the current generation.",
    )
  
  }

  async runStep9() {
    assert.equal(
      this.recoveryAcknowledgementObservation.queuedFillProcessedCount,
      1,
      "The queued fill must be drained before the broker recovery acknowledgement is attempted.",
    )
  
    assert.equal(
      this.recoveryAcknowledgementObservation.queuedFillMode,
      true,
      "The queued fill must be processed in recovery mode before broker acknowledgement.",
    )
  
    assert.equal(
      this.recoveryAcknowledgementObservation.fillAppliedCount,
      1,
      "The canonical BUY fill must already be applied exactly once when broker acknowledgement begins.",
    )
  
    assert.equal(
      this.recoveryAcknowledgementObservation.accountAuditDurable,
      true,
      "The RECOVERY account snapshot must be durably flushed before broker acknowledgement.",
    )
  
    assert.equal(
      this.recoveryAcknowledgementObservation.openOrdersAuditDurable,
      true,
      "The RECOVERY account-wide open-orders audit must be durably flushed before broker acknowledgement.",
    )
  
    assert.equal(
      this.recoveryReconciledStatusEvents.length,
      1,
      "The successful recovery generation must publish exactly one terminal reconciled status.",
    )
  
    assert.equal(
      this.recoveryCompletionLogs.length,
      1,
      "The successful recovery generation must emit exactly one application completion diagnostic.",
    )
  
    assert.equal(
      this.runtime.userDataReady,
      true,
      "Trading readiness may reopen only after queued events, canonical reconciliation, durable audits, and broker acknowledgement complete.",
    )
  
    assert.deepEqual(
      this.readinessTransitions,
      [true, false, true],
      "Readiness must close once for this recovery generation and reopen exactly once after successful global completion.",
    )
  
  }

  async runStep10() {
    await waitForTestSignal(
      this.twoOrdersSubmitted,
      "the initial BUY and recovery SELL submissions after the first BUY fill",
      () => ({
        submittedOrders: this.submittedOrders.map(({ side, price }) => ({
          side,
          price,
        })),
        userDataReady: this.runtime.userDataReady,
        userDataStatus: this.runtime.userDataStatus,
        errors: this.runtimeErrors,
      }),
    )

    assert.deepEqual(
      this.submittedOrders.map(({ side }) => side),
      ["BUY", "SELL"],
      "An initial BUY fill may create recovery coverage, but must not create a next standing BUY during the active cycle.",
    )
    this.replacementSell = this.submittedOrders.find((order) => order.side === "SELL")
    assert.ok(this.replacementSell, "The active cycle must have one recovery SELL.")
  }

  async runStep11() {
    this.baseBalance = "0.02"
    assert.equal(
      this.submittedOrders.filter((order) => order.side === "BUY").length,
      1,
      "No second BUY may be submitted before the recovery SELL is fully reconciled and the cycle completes.",
    )
    assert.equal(
      this.submittedOrders.filter((order) => order.side === "SELL").length,
      1,
      "The active cycle must reserve one recovery SELL.",
    )
  }

  async runStep12() {
    this.canonicalSell = new CanonicalOrder({
      clientOrderId: this.replacementSell.clientOrderId,
      brokerOrderId: `broker-${  this.replacementSell.clientOrderId}`,
      market: this.marketMetadata.market,
      side: "SELL",
      type: "LIMIT_MAKER",
      limitPrice: new Money({
        amount: this.replacementSell.price,
        asset: this.marketMetadata.market.quoteAsset
      }),
      originalQuantity: new Quantity({
        amount: this.replacementSell.quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      executedQuantity: new Quantity({
        amount: this.replacementSell.quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      status: "FILLED",
      createdAt: 1,
      acknowledgedAt: 1,
      updatedAt: 4,
      completedAt: 4,
    })
  
    this.sellFill = new Fill({
      tradeId: "testnet-sell-fill",
      brokerOrderId: this.canonicalSell.brokerOrderId,
      clientOrderId: this.canonicalSell.clientOrderId,
      market: this.marketMetadata.market,
      side: "SELL",
      price: new Money({
        amount: this.replacementSell.price,
        asset: this.marketMetadata.market.quoteAsset
      }),
      quantity: new Quantity({
        amount: this.replacementSell.quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      quoteQuantity: new Money({
        amount: multiplyDecimal({
          left: this.replacementSell.price,
          right: this.replacementSell.quantity
        }),
        asset: this.marketMetadata.market.quoteAsset,
      }),
      commissions: [],
      commissionStatus: "COMPLETE",
    })
  
    this.baseBalance = "0.001"
  
    this.userDataHandlers.onEvent({
      event: {
        eventType: "executionReport",
        executionType: "TRADE",
        executedOrder: this.canonicalSell,
        fill: this.sellFill,
      },
    })
  
  }

  async runStep13() {
    await waitForTestSignal(this.recoveryCompleted, "recovery.cycle_completed after the SELL fill", () => ({
      submittedOrders: this.submittedOrders.map(({
        side,
        price
      }) => ({
        side,
        price
      })),
      userDataReady: this.runtime.userDataReady,
      userDataStatus: this.runtime.userDataStatus,
      errors: this.runtimeErrors,
    }))
  
    assert.ok(this.runtimeDebug.some(({
      message,
      tradeId
    }) =>
      message === "Execution accounted" && tradeId === "testnet-buy-fill"), "TESTNET conservative recovery-cycle scenario: expected this.runtimeDebug.some(({\n      message,\n      tradeId\n    }) =>\n      message === \"Execution accounted\" && tradeId === \"testnet-buy-fill\") to be truthy.")
  
    assert.ok(this.runtimeDebug.some(({
      message,
      tradeId
    }) =>
      message === "Execution accounted" && tradeId === "testnet-sell-fill"), "TESTNET conservative recovery-cycle scenario: expected this.runtimeDebug.some(({\n      message,\n      tradeId\n    }) =>\n      message === \"Execution accounted\" && tradeId === \"testnet-sell-fill\") to be truthy.")
  
    assert.ok(this.runtimeDebug.some(({ message }) =>
      message === "recovery completion evaluation input"), "TESTNET conservative recovery-cycle scenario: expected this.runtimeDebug.some(({ message }) =>\n      message === \"recovery completion evaluation input\") to be truthy.")
  
    assert.ok(this.runtimeDebug.some(({ message }) =>
      message === "Recovery cycle completed"), "TESTNET conservative recovery-cycle scenario: expected this.runtimeDebug.some(({ message }) =>\n      message === \"Recovery cycle completed\") to be truthy.")
  
    await this.subscriptions.get("BTCUSDT")({
      eventType: "aggTrade",
      symbol: "BTCUSDT",
      price: "65000.12",
      timestamp: 1000,
    })
    await this.subscriptions.get("BTCUSDT")({
      eventType: "aggTrade",
      symbol: "BTCUSDT",
      price: "65000.20",
      timestamp: 1001,
    })
  
    // The first post-completion tick submits the next BUY. A second tick
    // exercises the existing trailing-BUY replacement behavior. Shutdown
    // then cancels the replacement BUY while leaving recovery SELLs untouched.
    assert.equal(this.submittedOrders.length, 4, "the completed recovery cycle must leave the initial BUY, recovery SELL, next BUY and its trailing replacement recorded")
  
    assert.equal(this.buyCancellationCount.value, 1, "the subsequent market tick must trail the standing BUY once")
  
    await this.runtime.stop()
  
    assert.equal(this.buyCancellationCount.value, 2, "shutdown must cancel the replacement standing BUY")
  
    this.position = this.runtime.portfolio.getPosition({ symbol: "BTCUSDT" })
  
    assert.equal(this.position.baseQuantity.amount, "0", "TESTNET conservative recovery-cycle scenario: expected this.position.baseQuantity.amount to equal \"0\".")
  
    assert.equal(this.position.freeBaseQuantity.amount, "0.001", "TESTNET conservative recovery-cycle scenario: expected this.position.freeBaseQuantity.amount to equal \"0.001\".")
  
    assert.equal(this.runtime.getRecoveryLedger({ marketId: this.marketMetadata.market.id }).buyCost, "0", "TESTNET conservative recovery-cycle scenario: expected this.runtime.getRecoveryLedger({ marketId: this.marketMetadata.market.id }).buyCost to equal \"0\".")
  
    assert.deepEqual(this.submittedOrders.map((order) => order.side), ["BUY", "SELL", "BUY", "BUY"], "TESTNET conservative recovery-cycle scenario: expected this.submittedOrders.map((order) => order.side) to deeply equal [\"BUY\", \"SELL\", \"BUY\", \"SELL\", \"BUY\", \"BUY\"].")
  }

  async run() {
    await this.runStep1()
    await this.runStep2()
    await this.runStep3()
    await this.runStep4()
    await this.runStep5()
    await this.runStep6()
    await this.runStep7()
    await this.runStep8()
    await this.runStep9()
    await this.runStep10()
    await this.runStep11()
    await this.runStep12()
    await this.runStep13()
  }
}

test("explicit TESTNET trading drains its first BUY fill once after 254 recovery reminders and completes the cycle", { timeout: 90_000 }, async () => {
  const scenario = new TestnetTradingRecoveryScenario()
  await scenario.run()
})

test("emits per-execution debug audit records with commission and before/after accounting", async () => {
  const debugRecords = []
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {},
    logger: {
      info() {},
      error() {},
      debug(record) { debugRecords.push(record) },
    },
  })

  const fill = createFill({
    tradeId: "audited-trade",
    quantity: "0.01"
  })
  const applied = await result.updateTradingAccounting({ fill })

  assert.equal(applied.ok, true, "Execution accounting debug audit: expected applied.ok to equal true.")
  const received = debugRecords.find((record) =>
    record.message === "Execution received")
  const committed = debugRecords.find((record) =>
    record.message === "Execution accounted")

  assert.equal(received.executionId, fill.id, "Execution accounting debug audit: expected received.executionId to equal fill.id.")
  assert.equal(received.tradeId, "audited-trade", "Execution accounting debug audit: expected received.tradeId to equal \"audited-trade\".")
  assert.equal(received.symbol, "BTCUSDT", "Execution accounting debug audit: expected received.symbol to equal \"BTCUSDT\".")
  assert.equal(received.side, "BUY", "Execution accounting debug audit: expected received.side to equal \"BUY\".")
  assert.equal(received.liquidityRole, "UNKNOWN", "Execution accounting debug audit: expected received.liquidityRole to equal \"UNKNOWN\".")
  assert.equal(received.executedAt, undefined, "Execution accounting debug audit: expected received.executedAt to equal undefined.")
  assert.equal(received.quantity, "0.01", "Execution accounting debug audit: expected received.quantity to equal \"0.01\".")
  assert.equal(received.quoteQuantity, "650", "Execution accounting debug audit: expected received.quoteQuantity to equal \"650\".")
  assert.equal(received.commissionStatus, "COMPLETE", "Execution accounting debug audit: expected received.commissionStatus to equal \"COMPLETE\".")
  assert.deepEqual(received.commissions, [], "Execution accounting debug audit: expected received.commissions to deeply equal [].")
  assert.equal(received.previousRecoveryLedger.legacyBuyCostMirror, "0", "Execution accounting debug audit: expected received.previousRecoveryLedger.legacyBuyCostMirror to equal \"0\".")
  assert.equal(committed.applied, true, "Execution accounting debug audit: expected committed.applied to equal true.")
  assert.equal(committed.duplicate, false, "Execution accounting debug audit: expected committed.duplicate to equal false.")
  assert.equal(committed.nextRecoveryLedger.legacyBuyCostMirror, "650", "Execution accounting debug audit: expected committed.nextRecoveryLedger.legacyBuyCostMirror to equal \"650\".")
  assert.equal(committed.nextRecoveryLedger.netSellProceeds, "0", "Execution accounting debug audit: expected committed.nextRecoveryLedger.netSellProceeds to equal \"0\".")
  assert.equal(committed.accountingDelta.portfolioActiveBase, "0.01", "Execution accounting debug audit: expected committed.accountingDelta.portfolioActiveBase to equal \"0.01\".")
  assert.equal(committed.accountingDelta.positionSpent, "650", "Execution accounting debug audit: expected committed.accountingDelta.positionSpent to equal \"650\".")
  assert.equal(committed.accountingDelta.netSellProceeds, "0", "Execution accounting debug audit: expected committed.accountingDelta.netSellProceeds to equal \"0\".")
  assert.equal(committed.accountingDelta.outstandingRecoveryAmount, "650", "Execution accounting debug audit: expected committed.accountingDelta.outstandingRecoveryAmount to equal \"650\".")
  assert.equal(committed.accountingDelta.realizedNetProfit, "-650", "Execution accounting debug audit: expected committed.accountingDelta.realizedNetProfit to equal \"-650\".")

  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "Execution accounting debug audit: expected result.stop() to reject or throw with /Harvester shutdown was incomplete/.")
  assert.equal(result.userDataStatus, "SHUTDOWN_INCOMPLETE", "Execution accounting debug audit: expected result.userDataStatus to equal \"SHUTDOWN_INCOMPLETE\".")
})

 

// Restored integration regressions retained across the bootstrap decomposition.

// Preserve both independent TRADING_MODE startup regressions.

function configureStartupHistoryBroker({ broker, calls }) {
  broker.getCanonicalOrderHistory = async ({ symbol, orderId }) => {
    calls.push(`history:orders:${symbol}:${orderId}`)
    return {
      ok: true,
      data: [],
    }
  }
  broker.getFills = async ({ symbol, fromId }) => {
    calls.push(`history:fills:${symbol}:${fromId}`)
    return {
      ok: true,
      data: [],
    }
  }
}

function createStartupHistoryPersistence({ persistedOrders, persistedFills }) {
  return {
    orderRepository: {
      upsertHistorical: async (record) => persistedOrders.push(record),
      findByExchangeOrderIdentity: async () => null,
      getOldestPendingOrderId: async () => null,
    },
    fillRepository: {
      upsert: async (input) => persistedFills.push(input),
    },
    historySyncCursorRepository: {
      get: async () => ({
        lastOrderId: null,
        lastTradeId: null,
      }),
      saveOrderCursor: async () => {},
      saveTradeCursor: async () => {},
    },
  }
}

function createHistoryCursorFailureOrder() {
  const metadata = createMarketMetadata("BTCUSDT")
  return new CanonicalOrder({
    clientOrderId: "h-history-cursor-failure",
    brokerOrderId: "100",
    market: metadata.market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: "65000",
      asset: metadata.market.quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "0.01",
      asset: metadata.market.baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "0.01",
      asset: metadata.market.baseAsset,
    }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
    completedAt: 1,
  })
}

function createHistoryCursorFailureFixture({ calls } = {}) {
  const broker = createBroker(calls)
  configureStartupHistoryBroker({
    broker,
    calls,
  })
  const historicalOrder = createHistoryCursorFailureOrder()
  broker.getCanonicalOrderHistory = async ({ symbol, orderId }) => {
    calls.push(`history:orders:${symbol}:${orderId}`)
    return {
      ok: true,
      data: symbol === "BTCUSDT" ? [historicalOrder] : [],
    }
  }
  const persistedOrders = []
  const persistedFills = []
  const orderHistoryPersistence = createStartupHistoryPersistence({
    persistedOrders,
    persistedFills,
  })
  const cursorError = new Error("simulated cursor write failure")
  cursorError.code = "HARVESTER_HISTORY_CURSOR_WRITE_FAILED"
  orderHistoryPersistence.historySyncCursorRepository.saveOrderCursor = async ({ symbol }) => {
    if (symbol === "BTCUSDT") {
      throw cursorError
    }
  }
  return {
    broker,
    orderHistoryPersistence,
    persistedOrders,
    persistedFills,
  }
}

function assertHistoryCursorFailureDiagnostics({
  errors,
  runtime,
  persistedOrders,
  persistedFills,
  calls,
} = {}) {
  const failure = errors.find((entry) =>
    entry.message === "Exchange history synchronization failed; historical coverage is incomplete")
  assert.ok(failure, "A failed startup cursor write must emit an actionable history-sync error.")
  assert.equal(failure.errorName, "AccountHistorySynchronizationError", "The aggregate startup error type must be stable.")
  assert.equal(failure.errorCode, "HARVESTER_ACCOUNT_HISTORY_SYNC_FAILED", "The aggregate startup error code must be stable.")
  assert.equal(failure.errorMessage, "Account history synchronization failed for 1 of 2 configured markets", "The failure summary must count failed configured markets.")
  assert.equal(failure.symbol, "BTCUSDT", "The startup diagnostic must identify the failed market.")
  assert.equal(failure.failureStage, "ORDER_CURSOR_SAVE", "The startup diagnostic must identify cursor persistence as the failure stage.")
  assert.equal(failure.historyDiagnostics.currentMarket, null, "The completed scan must not leave a market marked as active.")
  assert.equal(failure.historyDiagnostics.orderPagesChecked, 2, "Both configured markets must receive an order-history request.")
  assert.equal(failure.historyDiagnostics.ordersObserved, 1, "The failed market order must be counted as observed.")
  assert.equal(failure.historyDiagnostics.ordersPersisted, 1, "The persisted order must remain visible after cursor failure.")
  assert.equal(failure.historyDiagnostics.fillPagesChecked, 1, "Only the independent market may proceed to its fill scan.")
  assert.equal(failure.historyDiagnostics.failureCount, 1, "The aggregate must contain exactly the failed market.")
  assert.deepEqual(failure.historyDiagnostics.marketsAttempted, ["BTCUSDT", "ETHUSDT"], "Diagnostics must preserve the configured market attempt order.")
  assert.deepEqual(failure.historyDiagnostics.orderMarketsQueried, ["ETHUSDT"], "Only the later market may complete order history.")
  assert.deepEqual(failure.historyDiagnostics.fillMarketsQueried, ["ETHUSDT"], "The later market must complete fill history independently.")
  assert.deepEqual(failure.historyDiagnostics.marketsQueried, ["ETHUSDT"], "Only fully synchronized markets may be marked queried.")
  assert.deepEqual(failure.historyDiagnostics.marketsFailed, ["BTCUSDT"], "The cursor failure must remain attributed to BTCUSDT.")
  assert.equal(failure.historyDiagnostics.failures[0].market, "BTCUSDT", "The record-level failure must identify its market.")
  assert.equal(failure.historyDiagnostics.failures[0].failureStage, "ORDER_CURSOR_SAVE", "The record-level failure must identify cursor advancement.")
  assert.equal(failure.historyDiagnostics.failures[0].errorCode, "HARVESTER_HISTORY_CURSOR_WRITE_FAILED", "The original persistence error code must be retained.")
  assert.equal(failure.historyDiagnostics.failures[0].lastPersistedOrderId, "100", "Diagnostics must retain the last persisted order ID.")
  assert.equal(failure.historyDiagnostics.historyPagesComplete, false, "Any market failure must keep overall history incomplete.")
  assert.equal(runtime.tradingEnabled, true, "A history-projection failure must remain visible without becoming trading-state authority.")
  assert.equal(persistedOrders.length, 1, "The page's order must remain persisted when only cursor advancement fails.")
  assert.equal(persistedFills.length, 0, "Fill history must not start after the order cursor write fails.")
  assert.equal(calls.includes("history:fills:BTCUSDT:0"), false, "The failed market must skip its fill scan.")
  assert.equal(calls.includes("history:fills:ETHUSDT:0"), true, "A later independent market must still scan its fills.")
}

test("logs partial startup history diagnostics when an order cursor write fails", async () => {


  const calls = []
  const fixture = createHistoryCursorFailureFixture({ calls })
  const errors = []
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    providerIdentity: {
      providerInstanceId: "binanceTestnet",
      providerType: "binance",
      accountId: "binance-primary",
    },
    orderHistoryPersistence: fixture.orderHistoryPersistence,
    brokerAdapterFactory: () => fixture.broker,
    logger: {
      info() {},
      warn() {},
      error: (entry) => errors.push(entry),
    },
  })

  try {
    assertHistoryCursorFailureDiagnostics({
      errors,
      runtime,
      persistedOrders: fixture.persistedOrders,
      persistedFills: fixture.persistedFills,
      calls,
    })
  } finally {
    await runtime.stop()
  }
})


async function createPersistedAccountStopForRestart({ directory, store } = {}) {
  const config = createRsOnlyStartupConfig()
  const baseline = await recordConfigurationBaseline({
    operationalStateStore: store,
    appConfig: config,
  })
  assert.equal(baseline.ok, true, baseline.errors?.[0]?.message)
  const processStarted = await recordProcessStarted({
    operationalStateStore: store,
    configurationFingerprint: baseline.data.fingerprint,
    strategyName: baseline.data.strategyName,
    markets: baseline.data.markets,
    tradingEnabled: true,
  })
  assert.equal(processStarted.ok, true, processStarted.errors?.[0]?.message)

  const workflowResult = await createRecoverySellerStopWorkflow({
    operationalStateStore: store,
  })
  assert.equal(workflowResult.ok, true, "The startup fixture must create a Recovery Seller STOP workflow.")
  const latched = await workflowResult.data.latch({
    explanation: "Integration test: restore an unresolved RS investment STOP before startup",
  })
  assert.equal(latched.ok, true, "The integration fixture must durably persist the RS STOP.")

  const stopped = await recordProcessStopped({
    operationalStateStore: store,
    reason: "TEST_CLEAN_STOP_WITH_RS_STOP",
    clean: true,
  })
  assert.equal(stopped.ok, true, stopped.errors?.[0]?.message)

  const restartStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "rs-only-startup-next-session",
  })
  const restartRead = await restartStore.readAll()
  assert.equal(restartRead.ok, true, "The simulated restart must verify the same ledger under a new process session.")
  const restoredWorkflow = await createRecoverySellerStopWorkflow({
    operationalStateStore: restartStore,
  })
  assert.equal(restoredWorkflow.ok, true, restoredWorkflow.errors?.[0]?.message)
  assert.equal(restoredWorkflow.data.isBuyAdmissionBlocked(), true,
    "A fresh process-session workflow must restore the durable RS investment BUY gate.")
  assert.equal(restoredWorkflow.data.isSellAdmissionBlocked(), false,
    "A restored durable RS STOP must leave the first recovery SELL gate independently available.")
  return restartStore
}
async function seedAccountBlocker({ store, config = appConfig, includeProcessHistory = false } = {}) {
  if (includeProcessHistory) {
    const baseline = await recordConfigurationBaseline({
      operationalStateStore: store,
      appConfig: config,
    })
    assert.equal(baseline.ok, true, baseline.errors?.[0]?.message)
    const started = await recordProcessStarted({
      operationalStateStore: store,
      configurationFingerprint: baseline.data.fingerprint,
      strategyName: baseline.data.strategyName,
      markets: baseline.data.markets,
      tradingEnabled: true,
    })
    assert.equal(started.ok, true, started.errors?.[0]?.message)
  }

  const raised = await recordSafetyBlockerRaised({
    operationalStateStore: store,
    scope: "ACCOUNT",
    symbol: null,
    reason: "ACCOUNT_RECONCILIATION_REQUIRED",
    evidenceDigest: "a".repeat(64),
  })
  assert.equal(raised.ok, true, raised.errors?.[0]?.message)

  if (includeProcessHistory) {
    const stopped = await recordProcessStopped({
      operationalStateStore: store,
      reason: "TEST_CLEAN_STOP_WITH_ACCOUNT_BLOCKER",
      clean: true,
    })
    assert.equal(stopped.ok, true, stopped.errors?.[0]?.message)
  }
}

async function assertStartupRejectedBeforeBroker({ scenario, store } = {}) {
  const calls = []
  let runtime
  let startupError
  try {
    runtime = await startHarvesterForTest({
      loadConfig: async () => scenario.config,
      env: binanceEnv,
      brokerAdapterFactory: () => scenario.createBroker(calls),
      operationalStateStore: store,
      ...scenario.startupOptions,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
    })
  } catch (error) {
    startupError = error
  }

  try {
    assert.ok(startupError, `${scenario.name}: startup must reject an unresolved ACCOUNT blocker before broker connection.`)
    assert.match(startupError.message, scenario.errorPattern)
    assert.equal(calls.length, 0, `${scenario.name}: startup must reject before broker connection or market-data subscription.`)
  } finally {
    await runtime?.stop()
  }
}

test("rejects an unprojectable account-blocker ledger before broker connection for every recovery configuration", async () => {
  const scenarios = [
    {
      name: "Conservative-only with recovery disabled",
      config: appConfig,
      createBroker: (calls) => createBroker(calls),
      errorPattern: /Safety-blocker fact is outside an active process session/i,
    },
    {
      name: "Recovery Seller enabled",
      config: createRsOnlyStartupConfig(),
      createBroker: (calls) => createRsOnlyStartupBroker({ calls }),
      startupOptions: {
        executionSymbols: ["LINEAUSDT"],
        executionRoutes: [
          {
            strategyId: "RS_recoverySeller",
            symbol: "LINEAUSDT",
          },
        ],
        marketDataSymbols: ["LINEAUSDT"],
        evaluateRecoverySellerTransition: async () => ({
          ok: true,
          data: { skipped: true },
        }),
      },
      errorPattern: /Safety-blocker fact is outside an active process session/i,
    },
  ]

  for (const scenario of scenarios) {
    const { directory, store } = await createRsOnlyOperationalStateStore()
    try {
      await seedAccountBlocker({ store })
      await assertStartupRejectedBeforeBroker({
        scenario,
        store,
      })
    } finally {
      await rm(directory, {
        recursive: true,
        force: true,
      })
    }
  }
})

test("rejects a durable unresolved account blocker in Conservative-only mode when CG recovery is disabled", async (t) => {
  const { directory, store } = await createRsOnlyOperationalStateStore()
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  await seedAccountBlocker({
    store,
    config: appConfig,
    includeProcessHistory: true,
  })
  const restartStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "cg-only-startup-next-session",
  })

  await assertStartupRejectedBeforeBroker({
    scenario: {
      name: "Conservative-only with recovery disabled",
      config: appConfig,
      createBroker: (calls) => createBroker(calls),
      errorPattern: /unresolved account-scoped safety blocker/i,
    },
    store: restartStore,
  })
})

async function startHarvesterWithUserDataBlockerReasonCollision({
  directory,
  store,
  broker,
}) {
  await seedAccountBlockerRestartSession({
    store,
    config: createRsOnlyStartupConfig(),
    reason: "RECOVERY_SELLER_UNEXPECTED_CONDITION",
  })
  const restartStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "user-data-rs-stop-reason-collision",
  })
  return startHarvesterForTest({
    loadConfig: async () => createRsOnlyStartupConfig(),
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    operationalStateStore: restartStore,
    executionSymbols: ["LINEAUSDT"],
    executionRoutes: [{
      strategyId: "RS_recoverySeller",
      symbol: "LINEAUSDT",
    }],
    marketDataSymbols: ["LINEAUSDT"],
    evaluateRecoverySellerTransition: async () => ({
      ok: true,
      data: { skipped: true },
    }),
    logger: {
      info() {},
      error() {},
    },
  })
}

test("rejects a user-data ACCOUNT blocker with the RS STOP reason instead of treating it as an RS restart latch", async () => {
  const { directory, store } = await createRsOnlyOperationalStateStore()
  const calls = []
  const broker = createRsOnlyStartupBroker({ calls })
  let startedRuntime
  try {
    await assert.rejects(async () => {
      startedRuntime = await startHarvesterWithUserDataBlockerReasonCollision({
        directory,
        store,
        broker,
      })
    }, /Automatic Harvester trading-state restoration remains disabled/)
    assert.equal(calls.length, 0,
      "A user-data ACCOUNT blocker with the reserved RS reason must fail before broker startup.")
  } finally {
    if (startedRuntime) {
      await startedRuntime.stop()
    }
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("allows only an observation-only restart after account resolution and verifies a fresh durable PREFLIGHT snapshot pair", async () => {
  const { directory, store } = await createRsOnlyOperationalStateStore()
  const calls = []
  const broker = createRsOnlyStartupBroker({ calls })
  try {
    const config = createRsOnlyStartupConfig()
    const { restartStore, blockerId } = await createResolvedAccountBlockerRestartStore({
      directory,
      store,
      config,
    })
    const result = await startHarvesterForTest({
      loadConfig: async () => config,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      operationalStateStore: restartStore,
      executionSymbols: ["LINEAUSDT"],
      executionRoutes: [{
        strategyId: "RS_recoverySeller",
        symbol: "LINEAUSDT",
      }],
      marketDataSymbols: ["LINEAUSDT"],
      evaluateRecoverySellerTransition: async () => ({
        ok: true,
        data: { skipped: true },
      }),
      logger: {
        info() {},
        error() {},
      },
    })

    assert.equal(result.tradingEnabled, false, "Account recovery restart must remain observation-only.")
    assert.equal(result.executionEnabled, false, "Account recovery restart must not reopen execution.")
    assert.equal(result.userDataReady, false, "A fresh snapshot does not silently restore trading readiness.")
    const read = await restartStore.readAll()
    assert.equal(read.ok, true, read.errors?.[0]?.message)
    const { records } = read.data
    const resolutionIndex = records.findIndex((record) =>
      record.factType === "SAFETY_BLOCKER_RESOLVED" && record.data.blockerId === blockerId
    )
    const accountSnapshot = records.findLast((record) =>
      record.factType === "ACCOUNT_SNAPSHOT_CAPTURED" && record.data.phase === "PREFLIGHT"
    )
    const openOrdersSnapshot = records.findLast((record) =>
      record.factType === "ACCOUNT_OPEN_ORDERS_CAPTURED" && record.data.phase === "PREFLIGHT"
    )
    assert.ok(resolutionIndex >= 0)
    assert.ok(records.indexOf(accountSnapshot) > resolutionIndex)
    assert.ok(records.indexOf(openOrdersSnapshot) > resolutionIndex)
    assert.equal(accountSnapshot.runtimeSessionId, openOrdersSnapshot.runtimeSessionId)
    assert.equal(accountSnapshot.data.auditStatus, "COMPLETE")
    assert.equal(openOrdersSnapshot.data.readiness, "READY")
    await result.stop()
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

async function startHarvesterAfterPersistedRecoverySellerStop({
  directory,
  store,
  broker,
  onStrategyEvaluation,
}) {
  const restartStore = await createPersistedAccountStopForRestart({
    directory,
    store,
  })
  const result = await startHarvesterForTest({
    loadConfig: async () => createRsOnlyStartupConfig(),
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    operationalStateStore: restartStore,
    executionSymbols: ["LINEAUSDT"],
    executionRoutes: [
      {
        strategyId: "RS_recoverySeller",
        symbol: "LINEAUSDT",
      },
    ],
    marketDataSymbols: ["LINEAUSDT"],
    evaluateRecoverySellerTransition: onStrategyEvaluation,
    logger: {
      info() {},
      error() {},
    },
  })
  return {
    restartStore,
    result,
  }
}

test("restores a persisted RS STOP and keeps a restarted runtime observation-only", async () => {
  const { directory, store } = await createRsOnlyOperationalStateStore()
  const calls = []
  const broker = createRsOnlyStartupBroker({ calls })
  let strategyEvaluationCount = 0
  try {
    const { restartStore, result } = await startHarvesterAfterPersistedRecoverySellerStop({
      directory,
      store,
      broker,
      onStrategyEvaluation: async () => {
        strategyEvaluationCount += 1
        return {
          ok: true,
          data: { skipped: true },
        }
      },
    })
    assert.equal(result.tradingEnabled, false,
      "A clean restart with a durable RS STOP must remain observation-only until controlled restart acceptance.")
    assert.equal(result.executionEnabled, false,
      "A persisted RS STOP must not implicitly resume any execution route after process restart.")
    const restoredWorkflow = await createRecoverySellerStopWorkflow({
      operationalStateStore: restartStore,
    })
    assert.equal(restoredWorkflow.ok, true, restoredWorkflow.errors?.[0]?.message)
    assert.equal(restoredWorkflow.data.getStopState().status, "STOPPED",
      "Restart must not implicitly clear the durable RS STOP.")
    assert.equal(restoredWorkflow.data.isBuyAdmissionBlocked(), true,
      "Restart must preserve the RS investment BUY gate.")
    assert.equal(restoredWorkflow.data.isSellAdmissionBlocked(), false,
      "The durable STOP semantics remain investment-only; startup's separate observation-only gate prevents implicit resume.")
    await result.processMarketPrice({
      symbol: "LINEAUSDT",
      priceEvent: {
        symbol: "LINEAUSDT",
        price: "100",
        timestamp: 2,
      },
    })
    assert.equal(strategyEvaluationCount, 0,
      "An observation-only restart must prevent strategy evaluation until controlled restart acceptance.")
    assert.equal(calls.some((call) => typeof call === "object" && call.side), false,
      "An observation-only restart must not submit broker orders.")
    await result.stop()
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})

test("skips startup account-history synchronization when the master recovery component is disabled", async () => {
  const calls = []
  const fixture = createHistoryCursorFailureFixture({ calls })
  const configuredApp = {
    ...appConfig,
    components: { recovery: { enabled: false } },
  }
  const runtime = await startHarvesterForTest({
    loadConfig: async () => configuredApp,
    env: binanceEnv,
    providerIdentity: {
      providerInstanceId: "binanceTestnet",
      providerType: "binance",
      accountId: "binance-primary",
    },
    orderHistoryPersistence: fixture.orderHistoryPersistence,
    brokerAdapterFactory: () => fixture.broker,
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  })

  try {
    assert.equal(calls.some((call) => call.startsWith("history:")), false, "Disabled recovery must not fetch or synchronize historical exchange orders or fills.")
    assert.equal(fixture.persistedOrders.length, 0, "Disabled recovery must not backfill historical orders into relational persistence.")
    assert.equal(fixture.persistedFills.length, 0, "Disabled recovery must not backfill historical fills into relational persistence.")
  } finally {
    await runtime.stop()
  }
})
