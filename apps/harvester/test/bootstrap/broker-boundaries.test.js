import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "./start-harvester-test-support.js"

const { appConfig, createBroker, binanceEnv, startHarvesterForTest, createBinanceCapabilities, createMarketMetadata, createBinanceBrokerAdapter } = shared
const test = (...args) => nodeTest(`[broker-boundaries.test.js] ${args[0]}`, ...args.slice(1))

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

function createPostOnlyAdapterClient() {
  return {
    capabilities: createBinanceCapabilities(),
    connect: async () => {},
    disconnect: async () => {},
    createOrder: async () => ({
      ok: true,
    }),
    cancelOrder: async () => ({
      ok: true,
    }),
    getOpenOrders: async () => ({
      ok: true,
      data: [],
    }),
    getFills: async () => ({
      ok: true,
    }),
    getCanonicalOrderHistory: async () => ({
      ok: true,
    }),
    getCanonicalOrder: async () => ({
      ok: false,
      errors: [new Error("order not found")],
    }),
    getAccountSnapshot: async () => ({
      ok: true,
    }),
    getSymbolFilters: async () => ({
      ok: true,
    }),
    getExchangeMarkets: async () => ({
      ok: true,
      data: [],
    }),
    getPrices: async () => ({
      ok: true,
    }),
    getCandles: async () => ({
      ok: true,
      data: [],
    }),
    subscribeForPrices: async () => ({
      ok: true,
    }),
    subscribeForCandles: async () => ({
      ok: true,
      data: {
        unsubscribe: async () => {},
      },
    }),
    subscribeForBookTicker: async () => ({
      ok: true,
    }),
    subscribeForUserData: async () => ({
      ok: true,
    }),
  }
}

function createPostOnlyTestBroker({ client }) {
  return createBinanceBrokerAdapter({
    config: {
      apiKey: "test-key",
      apiSecret: "test-secret",
      tradingMode: "testnet",
    },
    brokerFactory: () => client,
  })
}

async function assertPostOnlyRejectionClassification({ broker, client }) {
  const rejection = Object.assign(new Error("Order would immediately match and take."), {
    code: -2010,
  })
  client.createCanonicalOrder = async () => ({
    ok: false,
    errors: [rejection],
  })
  const result = await broker.placeOrder({
    order: {
      symbol: "BTCUSDT",
      type: "LIMIT_MAKER",
    },
  })
  assert.equal(result.errors[0].code, "POST_ONLY_WOULD_TAKE", "Only Binance Spot’s definite maker-only rejection must be normalized to POST_ONLY_WOULD_TAKE.")

  const unrelated = Object.assign(new Error("insufficient balance"), {
    code: -2010,
  })
  client.createCanonicalOrder = async () => ({
    ok: false,
    errors: [unrelated],
  })
  const other = await broker.placeOrder({
    order: {
      symbol: "BTCUSDT",
      type: "LIMIT_MAKER",
    },
  })
  assert.equal(other.errors[0], unrelated, "An unrelated Binance rejection must retain its original error identity.")

  const unknownOutcome = Object.assign(new Error("Order would immediately match and take."), {
    code: -2010,
    outcomeUnknown: true,
  })
  client.createCanonicalOrder = async () => ({
    ok: false,
    errors: [unknownOutcome],
  })
  const unknown = await broker.placeOrder({
    order: {
      symbol: "BTCUSDT",
      type: "LIMIT_MAKER",
    },
  })
  assert.equal(unknown.errors[0], unknownOutcome, "An outcome-unknown rejection must not be downgraded to a definite POST_ONLY_WOULD_TAKE result.")
}

async function assertBookTickerCallbackForwarded({ broker, client }) {
  let forwardedSubscription
  const onBookTicker = () => {}
  client.subscribeForBookTicker = async (input) => {
    forwardedSubscription = input
    return {
      ok: true,
      data: {
        unsubscribe: async () => {},
      },
    }
  }
  await broker.subscribeForBookTicker({
    symbol: "BTCUSDT",
    onBookTicker,
  })
  assert.equal(forwardedSubscription.symbol, "BTCUSDT", "The broker adapter must forward the requested book-ticker market symbol.")
  assert.equal(forwardedSubscription.onBookTicker, onBookTicker, "The broker adapter must forward the exact book-ticker callback supplied by the runtime.")
}

test("fails closed when TRADING_MODE is missing, before broker construction", async () => {
  let brokerFactoryCalled = false
  await assert.rejects(
    startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: { TRADING_MODE: undefined },
    brokerAdapterFactory: () => { brokerFactoryCalled = true; return createBroker() },
  }), /TRADING_MODE must be set to "testnet" or "live"/, "Startup must reject a missing trading mode before constructing the broker.")
  assert.equal(brokerFactoryCalled, false, "The invalid trading-mode configuration must fail before broker construction.")
})

test("rejects enabling the deferred Aggressive strategy in app config", async () => {
  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => ({
        ...appConfig,
        strategies: {
        ...appConfig.strategies,
        CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        settings: {
        ...appConfig.strategies.CG_coinGrabber.settings,
        aggressive: { enabled: true }
      }
      }
      }
      }),
      env: binanceEnv,
      brokerAdapterFactory: () => createBroker(),
      logger: {
        info() {},
        error() {}
      },
    }),
    /Aggressive strategy is disabled and deferred/,
    "The deferred Aggressive strategy must remain unavailable until its implementation is complete.",
  )
})

test("synchronizes configured Binance history before activating the trading engine", async () => {
  const calls = []
  const broker = createBroker(calls)
  configureStartupHistoryBroker({
    broker,
    calls,
  })
  const persistedOrders = []
  const persistedFills = []
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    providerIdentity: {
      providerInstanceId: "binanceTestnet",
      providerType: "binance",
      accountId: "binance-primary",
    },
    orderHistoryPersistence: createStartupHistoryPersistence({
      persistedOrders,
      persistedFills,
    }),
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  })
  try {
    const orderHistoryIndex = calls.indexOf("history:orders:BTCUSDT:0")
    const fillHistoryIndex = calls.indexOf("history:fills:BTCUSDT:0")
    const marketDataIndex = calls.indexOf("subscribe:BTCUSDT")
    assert.ok(orderHistoryIndex >= 0, "Startup must query canonical order history for the configured execution market.")
    assert.ok(fillHistoryIndex > orderHistoryIndex, "Startup must query trade history after loading the market's order identities.")
    assert.ok(fillHistoryIndex < marketDataIndex, "Startup history synchronization must finish before market-data activation.")
    assert.equal(runtime.tradingEnabled, true, "A read-only history scan must not change trading enablement.")
    assert.equal(persistedOrders.length, 0, "An empty exchange history must not fabricate orders.")
    assert.equal(persistedFills.length, 0, "An empty exchange history must not fabricate fills.")
  } finally {
    await runtime.stop()
  }
})

test("passes live TRADING_MODE to the Binance broker factory during startup", async () => {
  let brokerConfig
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "test",
      TRADING_MODE: "live"
    },
    brokerAdapterFactory: ({ config }) => {
      brokerConfig = config
      return createBroker([], { tradingMode: config.tradingMode })
    },
    logger: {
      info() {},
      error() {}
    },
  })

  assert.equal(result.tradingMode, "live", "The runtime must preserve the explicit live trading mode.")
  assert.equal(brokerConfig.tradingMode, "live", "The Binance broker factory must receive the explicit live trading mode.")
  await result.stop()
})

test("rejects an invalid TRADING_MODE before connecting to Binance", async () => {
  let brokerFactoryCalled = false
  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: { TRADING_MODE: "production" },
    brokerAdapterFactory: () => { brokerFactoryCalled = true; return createBroker() },
  }), /TRADING_MODE must be set to "testnet" or "live"/, "Unsupported trading-mode values must fail closed before broker construction.")
  assert.equal(brokerFactoryCalled, false, "An invalid trading-mode value must fail before broker construction.")
})

test("disconnects after a failed broker connection", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.connect = async () => {
    calls.push("connect")
    throw new Error("connection failed")
  }
  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
    }),
    /connection failed/,
    "A failed broker connection must abort startup and enter cleanup.",
  )
  assert.deepEqual(calls, ["connect", "disconnect"], "A failed broker connection must still trigger broker disconnection during rollback.")
})

test("fails startup when the configured post-only order type is unsupported", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.getSymbolFilters = async ({ symbol }) => {
    calls.push(`filters:${  symbol}`)
    return {
      ok: true,
      data: {
        ...createMarketMetadata(symbol),
        supportedOrderTypes: ["LIMIT", "MARKET"],
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
    /does not support required LIMIT_MAKER/,
    "Startup must reject a market that cannot support the configured post-only order type.",
  )
  assert.deepEqual(calls, ["connect", "filters:BTCUSDT", "disconnect"], "Missing required exchange metadata must fail before subscriptions and disconnect the broker.")
})

test("normalizes only Binance Spot's definite POST-ONLY rejection", async () => {
  const client = createPostOnlyAdapterClient()
  const broker = createPostOnlyTestBroker({
    client,
  })
  await assertPostOnlyRejectionClassification({
    broker,
    client,
  })
  await assertBookTickerCallbackForwarded({
    broker,
    client,
  })
})

test("requires an explicit TRADING_MODE before connecting to Binance", async () => {
  let brokerFactoryCalled = false
  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: { TRADING_MODE: undefined },
    brokerAdapterFactory: () => { brokerFactoryCalled = true; return createBroker() },
  }), /TRADING_MODE must be set to "testnet" or "live"/, "The application must require an explicit trading mode before creating the broker.")
  assert.equal(brokerFactoryCalled, false, "A missing trading mode must fail closed before broker construction.")
})

test("does not expose or construct a partial Bitunix runtime from credentials", async () => {
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      BITUNIX_API_KEY: "bitunix-key",
      BITUNIX_API_SECRET: "bitunix-secret",
    },
    brokerAdapterFactory: () => createBroker(),
  })
  try {
    assert.equal(
      Object.hasOwn(runtime, "readOnlyProviders"),
      false,
      "Harvester must not expose a partial Bitunix-only runtime surface.",
    )
    assert.equal(
      runtime.tradingEnabled,
      true,
      "Unconfigured Bitunix credentials must not change the existing Binance execution runtime.",
    )
  } finally {
    await runtime.stop()
  }
})
