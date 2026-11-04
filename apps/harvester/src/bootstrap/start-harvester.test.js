import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Balance, CanonicalOrder, Fill, Market, Money, Quantity, TradingRules } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { multiplyDecimal } from "@coinzilla/utils"
import { startHarvester } from "./start-harvester.js"
import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"

async function waitForTestSignal(promise, label, getDiagnostics, timeoutMs = 15_000) {
  let timeout
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(
            label + " was not observed within " + timeoutMs + "ms; diagnostics: " +
            JSON.stringify(getDiagnostics()),
          ))
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

const tradingConfig = {
  settings: { minProfit: 0.01 },
  strategies: { conservative: { enabled: true }, aggressive: { enabled: false } },
  pairs: {
    BTCUSDT: { enabled: true, investment: 100, orderQuantity: 0.01, makerPercent: 0 },
    ETHUSDT: { enabled: false, orderQuantity: 0.1, makerPercent: 0 },
  },
}
const createMarketMetadata = (symbol) => {
  const baseCode = symbol.replace(/USDT$/, "")
  const baseAsset = new Asset({ id: "asset:" + baseCode, code: baseCode })
  const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
  const market = new Market({
    venue: "binance",
    symbol,
    baseAsset,
    quoteAsset,
  })
  const tradingRules = new TradingRules({
    market,
    constraints: [
      { type: "PRICE_INCREMENT", status: "SUPPORTED", value: new Money({ amount: "0.01", asset: quoteAsset }) },
      { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: new Quantity({ amount: "0.001", asset: baseAsset }) },
      { type: "MIN_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: "0.001", asset: baseAsset }) },
      { type: "MIN_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: "5", asset: quoteAsset }) },
    ],
  })
  return {
    market,
    tradingRules,
    supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"],
  }
}
const createBroker = (calls = [], { subscribeResult, subscribeResultBySymbol = {} } = {}) => {
  const subscriptions = new Map()
  const bookSubscriptions = new Map()
  let userDataHandlers
  let accountSnapshotTime = 0
  return {
    connect: async () => calls.push("connect"),
    disconnect: async () => calls.push("disconnect"),
    placeOrder: async () => ({ ok: true }),
    cancelOrder: async () => ({ ok: true }),
    getOpenOrders: async () => ({ ok: true }),
    getFills: async () => ({ ok: true }),
    getCanonicalOrderHistory: async () => ({ ok: true, data: [] }),
    getAccountSnapshot: async () => {
      calls.push("account:snapshot")
      accountSnapshotTime += 1
      const balances = ["BTC", "ETH", "USDT"].map((code) => {
        const asset = new Asset({ id: "asset:" + code, code })
        return new Balance({
          free: new Quantity({ amount: "1000", asset }),
          locked: new Quantity({ amount: "0", asset }),
        })
      })
      return {
        ok: true,
        data: { balances, sourceTime: accountSnapshotTime },
      }
    },
    getSymbolFilters: async ({ symbol }) => {
      calls.push("filters:" + symbol)
      return { ok: true, data: createMarketMetadata(symbol) }
    },
    getPrices: async ({ symbol }) => ({ ok: true, data: { symbol, price: "65000" } }),
    subscribeForPrices: async ({ symbol, onPrice }) => {
      calls.push("subscribe:" + symbol)
      subscriptions.set(symbol, onPrice)
      return subscribeResultBySymbol[symbol] ?? subscribeResult ?? {
        ok: true,
        data: { unsubscribe: async () => calls.push("unsubscribe:" + symbol) },
      }
    },
    subscribeForBookTicker: async ({ symbol, onBookTicker }) => {
      calls.push("subscribe:book:" + symbol)
      bookSubscriptions.set(symbol, onBookTicker)
      return { ok: true, data: { unsubscribe: async () => calls.push("unsubscribe:book:" + symbol) } }
    },
    subscribeForUserData: async (handlers) => {
      calls.push("subscribe:user-data")
      userDataHandlers = handlers
      return {
        ok: true,
        data: { disconnect: async () => calls.push("unsubscribe:user-data") },
      }
    },
    emitUserDataEvent: (event) => userDataHandlers?.onEvent({ event }),
    emitUserDataStatus: (status) => userDataHandlers?.onStatus(status),
    emitPrice: (symbol, priceEvent) => subscriptions.get(symbol)?.(priceEvent),
    emitBookTicker: (symbol, bookTicker) => bookSubscriptions.get(symbol)?.(bookTicker),
  }
}
const binanceEnv = {
  HARVESTER_BROKER: "binance",
  BINANCE_API_KEY: "key",
  BINANCE_API_SECRET_KEY: "secret",
}
const createFill = ({ tradeId = "trade-1", quantity = "0.01" } = {}) => {
  const baseAsset = new Asset({ id: "asset:BTC", code: "BTC" })
  const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
  const market = new Market({ venue: "binance", symbol: "BTCUSDT", baseAsset, quoteAsset })
  return new Fill({
    tradeId,
    brokerOrderId: "order-" + tradeId,
    market,
    side: "BUY",
    price: new Money({ amount: "65000", asset: quoteAsset }),
    quantity: new Quantity({ amount: quantity, asset: baseAsset }),
    quoteQuantity: new Money({ amount: "650", asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

test("does not connect a broker unless explicitly selected", async () => {
  const result = await startHarvester({ loadConfig: async () => tradingConfig, env: {} })
  assert.equal(result.tradingConfig, tradingConfig)
  assert.equal(result.broker, undefined)
  assert.equal(result.connected, false)
  assert.ok(result.portfolio instanceof Portfolio)
  await result.stop()
})

test("rejects enabling the deferred Aggressive strategy in trading config", async () => {
  await assert.rejects(
    startHarvester({
      loadConfig: async () => ({ ...tradingConfig, strategies: { ...tradingConfig.strategies, aggressive: { enabled: true } } }),
      env: binanceEnv,
      brokerAdapterFactory: () => createBroker(),
      logger: { info() {}, error() {} },
    }),
    /Aggressive strategy is disabled and deferred/,
  )
})

test("subscribes only enabled pairs and passes the current Portfolio to strategy", async () => {
  const calls = []
  const broker = createBroker(calls)
  const strategyCalls = []
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    evaluateStrategy: (input) => {
      strategyCalls.push(input)
      return { action: "NO_ACTION" }
    },
    logger: { info() {}, error() {} },
  })
  assert.equal(result.connected, true)
  assert.deepEqual(result.subscriptions, ["BTCUSDT"])
  assert.deepEqual(calls, [
    "connect",
    "filters:BTCUSDT",
    "subscribe:user-data",
    "account:snapshot",
    "subscribe:BTCUSDT",
  ])
  assert.equal(result.getMarketMetadata({ symbol: "BTCUSDT" }).market.symbol, "BTCUSDT")
  assert.equal(result.getMarketMetadata({ symbol: "ETHUSDT" }), undefined)
  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED")

  await broker.emitPrice("BTCUSDT", {
    eventType: "aggTrade",
    symbol: "BTCUSDT",
    price: "65000.12000000",
    timestamp: 123,
  })
  assert.equal(strategyCalls.length, 1)
  assert.deepEqual(strategyCalls[0].marketPrice, {
    symbol: "BTCUSDT",
    price: "65000.12000000",
    timestamp: 123,
  })
  assert.equal(strategyCalls[0].pairConfig, tradingConfig.pairs.BTCUSDT)
  assert.equal(strategyCalls[0].settings, tradingConfig.settings)
  assert.ok(strategyCalls[0].portfolio instanceof Portfolio)

  await result.stop()
  await result.stop()
  assert.deepEqual(calls, [
    "connect",
    "filters:BTCUSDT",
    "subscribe:user-data",
    "account:snapshot",
    "subscribe:BTCUSDT",
    "unsubscribe:BTCUSDT",
    "unsubscribe:user-data",
    "disconnect",
  ])
})

test("uses Conservative by default and passes updated Portfolio after a fill", async () => {
  const broker = createBroker()
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: { info() {}, error() {} },
  })
  const decision = await result.processMarketPrice({
    symbol: "BTCUSDT",
    priceEvent: { symbol: "BTCUSDT", price: "65000.12", timestamp: 123 },
    pairConfig: tradingConfig.pairs.BTCUSDT,
    settings: tradingConfig.settings,
  })
  assert.equal(decision.ok, true)
  assert.equal(decision.data.decision.strategy, "CONSERVATIVE")
  assert.equal(decision.data.decision.action, "NO_ACTION")
  assert.equal(result.portfolio.positions.length, 0)

  const fillResult = await result.updatePortfolio({ fill: createFill() })
  assert.equal(fillResult.ok, true)
  assert.equal(fillResult.data.applied, true)
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }).baseQuantity.amount, "0.01")

  const nextDecision = await result.processMarketPrice({
    symbol: "BTCUSDT",
    priceEvent: { symbol: "BTCUSDT", price: "65000.12", timestamp: 124 },
    pairConfig: tradingConfig.pairs.BTCUSDT,
    settings: tradingConfig.settings,
  })
  assert.equal(nextDecision.data.decision.position.baseQuantity.amount, "0.01")
  await result.stop()
})

test("serializes concurrent Portfolio updates without losing fills", async () => {
  const result = await startHarvester({ loadConfig: async () => tradingConfig, env: {} })
  const [first, second] = await Promise.all([
    result.updatePortfolio({ fill: createFill({ tradeId: "trade-1" }) }),
    result.updatePortfolio({ fill: createFill({ tradeId: "trade-2" }) }),
  ])
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }).baseQuantity.amount, "0.02")
  assert.equal(result.portfolio.appliedFillIds.length, 2)
})

test("disconnects when a market price subscription fails", async () => {
  const calls = []
  const broker = createBroker(calls, {
    subscribeResult: { ok: false, errors: [new Error("stream unavailable")] },
  })
  await assert.rejects(
    startHarvester({
      loadConfig: async () => tradingConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: { info() {}, error() {} },
    }),
    /Unable to subscribe to market prices for BTCUSDT: stream unavailable/,
  )
  assert.deepEqual(calls, [
    "connect",
    "filters:BTCUSDT",
    "subscribe:user-data",
    "account:snapshot",
    "subscribe:BTCUSDT",
    "unsubscribe:user-data",
    "disconnect",
  ])
})

test("unsubscribes earlier markets when a later market subscription fails", async () => {
  const calls = []
  const broker = createBroker(calls, {
    subscribeResultBySymbol: {
      ETHUSDT: { ok: false, errors: [new Error("stream unavailable")] },
    },
  })
  const config = {
    ...tradingConfig,
    pairs: {
      BTCUSDT: tradingConfig.pairs.BTCUSDT,
      ETHUSDT: { enabled: true, investment: 100, orderQuantity: 0.1, makerPercent: 0 },
    },
  }
  await assert.rejects(
    startHarvester({
      loadConfig: async () => config,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: { info() {}, error() {} },
    }),
    /Unable to subscribe to market prices for ETHUSDT/,
  )
  assert.deepEqual(calls, [
    "connect",
    "filters:BTCUSDT",
    "filters:ETHUSDT",
    "subscribe:user-data",
    "account:snapshot",
    "subscribe:BTCUSDT",
    "subscribe:ETHUSDT",
    "unsubscribe:BTCUSDT",
    "unsubscribe:user-data",
    "disconnect",
  ])
})

test("rejects an unsupported broker selection", async () => {
  await assert.rejects(
    startHarvester({ loadConfig: async () => tradingConfig, env: { HARVESTER_BROKER: "unknown" } }),
    /Unsupported HARVESTER_BROKER value: unknown/,
  )
})

test("disconnects after a failed broker connection", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.connect = async () => {
    calls.push("connect")
    throw new Error("connection failed")
  }
  await assert.rejects(
    startHarvester({
      loadConfig: async () => tradingConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
    }),
    /connection failed/,
  )
  assert.deepEqual(calls, ["connect", "disconnect"])
})

test("accounts canonical execution events without refreshing the initial account snapshot in read-only mode", async () => {
  const broker = createBroker()
  let handled
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    onUserDataEvent: async (input) => {
      handled = input.event
    },
    logger: { info() {}, error() {} },
  })

  broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    fill: createFill({ tradeId: "user-data-trade-1" }),
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(handled.eventType, "executionReport")
  assert.ok(handled.fill instanceof Fill)
  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED")
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }), undefined)
  assert.equal(result.getAccountSnapshot().sourceTime, 1)
  assert.equal(result.getRecoveryLedger({ marketId: handled.fill.market.id }), undefined)

  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await result.stop()
})

test("does not clear a genuine startup stream-recovery gate with only the initial balance snapshot", async () => {
  const broker = createBroker()
  const subscribeForUserData = broker.subscribeForUserData
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    handlers.onStatus({ type: "connectionClosed", recoveryRequired: true })
    return result
  }

  await assert.rejects(
    startHarvester({
      loadConfig: async () => tradingConfig,
      env: {
        ...binanceEnv,
        HARVESTER_ENABLE_TRADING: "true",
        HARVESTER_TRADING_MODE: "testnet",
        NODE_ENV: "test",
      },
      brokerAdapterFactory: () => broker,
      logger: { info() {}, error() {} },
    }),
    /user-data stream reconciliation is required/,
  )
})

test("does not adopt an external order report received before the ownership registry is ready", async () => {
  const calls = []
  const broker = createBroker(calls)
  const subscribeForUserData = broker.subscribeForUserData
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    handlers.onEvent({
      event: { eventType: "executionReport", executionType: "NEW" },
    })
    return result
  }

  await assert.rejects(
    startHarvester({
      loadConfig: async () => tradingConfig,
      env: {
        ...binanceEnv,
        HARVESTER_ENABLE_TRADING: "true",
        HARVESTER_TRADING_MODE: "testnet",
        NODE_ENV: "test",
      },
      brokerAdapterFactory: () => broker,
      logger: { info() {}, error() {} },
    }),
    /unowned or invalid user-data event before order ownership was initialized/,
  )
  assert.ok(calls.includes("disconnect"))
})

test("requires authoritative reconciliation after a user-data stream recovery", async () => {
  const broker = createBroker()
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: { info() {}, error() {} },
  })

  broker.emitUserDataStatus({
    type: "recovered",
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  assert.equal(result.userDataReady, false)

  broker.emitUserDataStatus({
    type: "reconciled",
    recoveryRequired: false,
  })
  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED")
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await result.stop()
})

test("does not become ready when recovery is reported during subscription setup", async () => {
  const broker = createBroker()
  const subscribeForUserData = broker.subscribeForUserData
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    handlers.onStatus({
      type: "recovered",
      recoveryRequired: true,
      reconciliationRequired: true,
    })
    return result
  }

  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: { info() {}, error() {} },
  })
  assert.equal(result.userDataReady, false)
  await result.stop()
})

test("does not surface a stream-ready status as application readiness before reconciliation", async () => {
  const broker = createBroker()
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: { info() {}, error() {} },
  })

  broker.emitUserDataStatus({ type: "ready", recoveryRequired: false })

  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED")
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await result.stop()
})

test("does not reopen order placement after execution accounting without authoritative reconciliation", async () => {
  const calls = []
  const broker = createBroker(calls)
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    onUserDataEvent: async () => {},
    logger: { info() {}, error() {} },
  })

  broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    fill: createFill({ tradeId: "trade-2" }),
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED")
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await result.stop()
})

test("fails startup closed when user-data subscription cannot be established", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.subscribeForUserData = async () => ({
    ok: false,
    errors: [new Error("user stream unavailable")],
  })

  await assert.rejects(
    startHarvester({
      loadConfig: async () => tradingConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: { info() {}, error() {} },
    }),
    /Unable to subscribe to user data: user stream unavailable/,
  )
  assert.deepEqual(calls, ["connect", "filters:BTCUSDT", "disconnect"])
})

test("does not expose a broker port that could bypass the trading engine", async () => {
  const broker = createBroker()
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: { info() {}, error() {} },
  })

  broker.emitUserDataStatus({
    type: "recovered",
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await result.stop()
})

test("does not adopt malformed external TRADE reports in read-only mode", async () => {
  const broker = createBroker()
  let observed
  const eventObserved = new Promise((resolve) => { observed = resolve })
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: { info() {}, error() {} },
    onUserDataEvent: async () => observed(),
  })

  broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    fill: { malformed: true },
  })
  await eventObserved

  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED")
  assert.equal(result.portfolio.positions.length, 0)
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await result.stop()
})

test("fails startup before opening streams when required minimum notional is unavailable", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.getSymbolFilters = async ({ symbol }) => {
    calls.push("filters:" + symbol)
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
    startHarvester({
      loadConfig: async () => tradingConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: { info() {}, error() {} },
    }),
    /Required exchange trading rule is unavailable: MIN_NOTIONAL/,
  )
  assert.deepEqual(calls, ["connect", "filters:BTCUSDT", "disconnect"])
})

test("fails startup when the configured post-only order type is unsupported", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.getSymbolFilters = async ({ symbol }) => {
    calls.push("filters:" + symbol)
    return {
      ok: true,
      data: {
        ...createMarketMetadata(symbol),
        supportedOrderTypes: ["LIMIT", "MARKET"],
      },
    }
  }

  await assert.rejects(
    startHarvester({
      loadConfig: async () => tradingConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: { info() {}, error() {} },
    }),
    /does not support required LIMIT_MAKER/,
  )
  assert.deepEqual(calls, ["connect", "filters:BTCUSDT", "disconnect"])
})

test("does not request another account snapshot after a TRADE when later snapshots would fail", async () => {
  const broker = createBroker()
  const getAccountSnapshot = broker.getAccountSnapshot
  let calls = 0
  broker.getAccountSnapshot = async () => {
    calls += 1
    if (calls === 1) return getAccountSnapshot()
    return { ok: false, errors: [new Error("account endpoint unavailable")] }
  }
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: { info() {}, error() {} },
  })

  broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    fill: createFill({ tradeId: "account-refresh-failure" }),
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED")
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }), undefined)
  assert.equal(result.getAccountSnapshot().sourceTime, 1)
  assert.equal(calls, 1)
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await result.stop()
})

test("fails startup when the exchange snapshot omits an enabled market asset", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.getAccountSnapshot = async () => {
    calls.push("account:snapshot")
    const asset = new Asset({ id: "asset:BTC", code: "BTC" })
    return {
      ok: true,
      data: {
        balances: [new Balance({
          free: new Quantity({ amount: "1", asset }),
          locked: new Quantity({ amount: "0", asset }),
        })],
        sourceTime: 1,
      },
    }
  }

  await assert.rejects(
    startHarvester({
      loadConfig: async () => tradingConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: { info() {}, error() {} },
    }),
    /missing required market asset balances: USDT/,
  )
  assert.deepEqual(calls, [
    "connect",
    "filters:BTCUSDT",
    "subscribe:user-data",
    "account:snapshot",
    "unsubscribe:user-data",
    "disconnect",
  ])
})


test("does not clear the read-only ownership gate after stream recovery acknowledgement", async () => {
  const broker = createBroker()
  let observed
  const eventObserved = new Promise((resolve) => { observed = resolve })
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: { info() {}, error() {} },
    onUserDataEvent: async () => observed(),
  })

  broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    fill: { malformed: true },
  })
  await eventObserved

  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED")

  broker.emitUserDataStatus({
    type: "reconciled",
    recoveryRequired: false,
  })

  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED")
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await result.stop()
})


test("explicit TESTNET trading submits the first Conservative BUY and reacts to its full fill", { timeout: 90_000 }, async () => {
  const calls = []
  const subscriptions = new Map()
  const bookSubscriptions = new Map()
  let userDataHandlers
  let snapshotTime = 0
  let baseBalance = "0"
  let signalRecoveryCompleted
  const recoveryCompleted = new Promise((resolve) => { signalRecoveryCompleted = resolve })
  const submittedOrders = []
  const runtimeErrors = []
  let resolveThreeOrders
  let resolveFiveOrders
  const threeOrdersSubmitted = new Promise((resolve) => { resolveThreeOrders = resolve })
  const fiveOrdersSubmitted = new Promise((resolve) => { resolveFiveOrders = resolve })
  const marketMetadata = createMarketMetadata("BTCUSDT")
  const broker = {
    connect: async () => calls.push("connect"),
    disconnect: async () => calls.push("disconnect"),
    getSymbolFilters: async () => ({ ok: true, data: marketMetadata }),
    getOpenOrders: async () => ({ ok: true, data: [] }),
    getPrices: async () => ({ ok: true, data: { symbol: "BTCUSDT", price: "65000" } }),
    cancelOrder: async ({ order }) => ({
      ok: true,
      data: new CanonicalOrder({
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
      }),
    }),
    getFills: async () => ({ ok: true, data: [] }),
    getCanonicalOrderHistory: async () => ({ ok: true, data: [] }),
    getAccountSnapshot: async () => {
      snapshotTime += 1
      const balances = [
        new Balance({
          free: new Quantity({ amount: baseBalance, asset: marketMetadata.market.baseAsset }),
          locked: new Quantity({ amount: "0", asset: marketMetadata.market.baseAsset }),
        }),
        new Balance({
          free: new Quantity({ amount: "10000", asset: marketMetadata.market.quoteAsset }),
          locked: new Quantity({ amount: "0", asset: marketMetadata.market.quoteAsset }),
        }),
      ]
      return { ok: true, data: { balances, sourceTime: snapshotTime } }
    },
    subscribeForUserData: async (handlers) => {
      userDataHandlers = handlers
      return { ok: true, data: { disconnect: async () => calls.push("unsubscribe:user-data") } }
    },
    subscribeForPrices: async ({ symbol, onPrice }) => {
      subscriptions.set(symbol, onPrice)
      return { ok: true, data: { unsubscribe: async () => calls.push("unsubscribe:" + symbol) } }
    },
    subscribeForBookTicker: async ({ symbol, onBookTicker }) => {
      bookSubscriptions.set(symbol, onBookTicker)
      return { ok: true, data: { unsubscribe: async () => calls.push("unsubscribe:book:" + symbol) } }
    },
    placeOrder: async ({ order }) => {
      calls.push({ side: order.side, price: order.price, quantity: order.quantity })
      submittedOrders.push(order)
      if (submittedOrders.length === 3) resolveThreeOrders()
      if (submittedOrders.length === 5) resolveFiveOrders()
      return {
        ok: true,
        data: new CanonicalOrder({
          clientOrderId: order.clientOrderId,
          brokerOrderId: "broker-" + order.clientOrderId,
          market: marketMetadata.market,
          side: order.side,
          type: order.type,
          limitPrice: new Money({ amount: order.price, asset: marketMetadata.market.quoteAsset }),
          originalQuantity: new Quantity({ amount: order.quantity, asset: marketMetadata.market.baseAsset }),
          executedQuantity: new Quantity({ amount: "0", asset: marketMetadata.market.baseAsset }),
          status: "OPEN",
          createdAt: 1,
          acknowledgedAt: 1,
          updatedAt: 1,
        }),
      }
    },
  }
  const config = {
    settings: { minProfit: 0.01 },
    strategies: { conservative: { enabled: true }, aggressive: { enabled: false } },
    pairs: {
      BTCUSDT: {
        enabled: true,
        investment: 2000,
        orderQuantity: 0.01,
        keepQuantity: 0.001,
        priceStepPercent: 0.05,
        pricePrecision: 2,
        quantityPrecision: 3,
        makerPercent: 0,
        takerPercent: 0.075,
      },
    },
  }
  const runtime = await startHarvester({
    loadConfig: async () => config,
    env: {
      NODE_ENV: "development",
      HARVESTER_BROKER: "binance",
      HARVESTER_TRADING_MODE: "testnet",
      HARVESTER_ENABLE_TRADING: "true",
      BINANCE_API_KEY: "test-key",
      BINANCE_API_SECRET_KEY: "test-secret",
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => {
        if (event.name === "recovery.cycle_completed") signalRecoveryCompleted()
        return { ok: true }
      },
    },
    now: () => 1000,
    logger: {
      info() {},
      error: (entry) => runtimeErrors.push({ message: entry.message, symbol: entry.symbol, reason: entry.reason, errors: entry.errors?.map((error) => error.message ?? String(error)) }),
    },
  })
  assert.equal(runtime.userDataReady, true)
  assert.equal(submittedOrders.length, 0, "the initial ticker snapshot must wait for a book ticker")
  await bookSubscriptions.get("BTCUSDT")({
    symbol: "BTCUSDT", bestBidPrice: "60000", bestBidQuantity: "1",
    bestAskPrice: "70000", bestAskQuantity: "1", timestamp: 1000,
  })
  assert.equal(submittedOrders.length, 1, "a fresh non-crossing book should release the initial BUY")
  assert.equal(submittedOrders[0].side, "BUY")

  const submitted = calls.find((call) => typeof call === "object")
  const clientOrderId = "h-BTCUSDT-1"
  const canonicalBuy = new CanonicalOrder({
    clientOrderId,
    brokerOrderId: "broker-" + clientOrderId,
    market: marketMetadata.market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: submitted.price, asset: marketMetadata.market.quoteAsset }),
    originalQuantity: new Quantity({ amount: submitted.quantity, asset: marketMetadata.market.baseAsset }),
    executedQuantity: new Quantity({ amount: submitted.quantity, asset: marketMetadata.market.baseAsset }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 2,
    completedAt: 2,
  })
  const fill = new Fill({
    tradeId: "testnet-buy-fill",
    brokerOrderId: canonicalBuy.brokerOrderId,
    market: marketMetadata.market,
    side: "BUY",
    price: new Money({ amount: submitted.price, asset: marketMetadata.market.quoteAsset }),
    quantity: new Quantity({ amount: submitted.quantity, asset: marketMetadata.market.baseAsset }),
    quoteQuantity: new Money({
      amount: "649.6761",
      asset: marketMetadata.market.quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  baseBalance = "0.01"
  userDataHandlers.onEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: canonicalBuy,
      fill,
    },
  })
  await waitForTestSignal(threeOrdersSubmitted, "three order submissions after the first BUY fill", () => ({
    submittedOrders: submittedOrders.map(({ side, price }) => ({ side, price })),
    userDataReady: runtime.userDataReady,
    userDataStatus: runtime.userDataStatus,
    errors: runtimeErrors,
  }))
  const secondBuyIntent = submittedOrders.find((order) => order.side === "BUY" && order.clientOrderId !== clientOrderId)
  const canonicalSecondBuy = new CanonicalOrder({
    clientOrderId: secondBuyIntent.clientOrderId,
    brokerOrderId: "broker-" + secondBuyIntent.clientOrderId,
    market: marketMetadata.market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: secondBuyIntent.price, asset: marketMetadata.market.quoteAsset }),
    originalQuantity: new Quantity({ amount: secondBuyIntent.quantity, asset: marketMetadata.market.baseAsset }),
    executedQuantity: new Quantity({ amount: secondBuyIntent.quantity, asset: marketMetadata.market.baseAsset }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 3,
    completedAt: 3,
  })
  const secondBuyFill = new Fill({
    tradeId: "testnet-second-buy-fill",
    brokerOrderId: canonicalSecondBuy.brokerOrderId,
    market: marketMetadata.market,
    side: "BUY",
    price: new Money({ amount: secondBuyIntent.price, asset: marketMetadata.market.quoteAsset }),
    quantity: new Quantity({ amount: secondBuyIntent.quantity, asset: marketMetadata.market.baseAsset }),
    quoteQuantity: new Money({
      amount: multiplyDecimal({ left: secondBuyIntent.price, right: secondBuyIntent.quantity }),
      asset: marketMetadata.market.quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  baseBalance = "0.02"
  userDataHandlers.onEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: canonicalSecondBuy,
      fill: secondBuyFill,
    },
  })
  await waitForTestSignal(fiveOrdersSubmitted, "five order submissions after the second BUY fill", () => ({
    submittedOrders: submittedOrders.map(({ side, price }) => ({ side, price })),
    userDataReady: runtime.userDataReady,
    userDataStatus: runtime.userDataStatus,
    errors: runtimeErrors,
  }))

  const replacementSell = submittedOrders.filter((order) => order.side === "SELL").at(-1)
  assert.equal(replacementSell.side, "SELL")
  const canonicalSell = new CanonicalOrder({
    clientOrderId: replacementSell.clientOrderId,
    brokerOrderId: "broker-" + replacementSell.clientOrderId,
    market: marketMetadata.market,
    side: "SELL",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: replacementSell.price, asset: marketMetadata.market.quoteAsset }),
    originalQuantity: new Quantity({ amount: replacementSell.quantity, asset: marketMetadata.market.baseAsset }),
    executedQuantity: new Quantity({ amount: replacementSell.quantity, asset: marketMetadata.market.baseAsset }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 4,
    completedAt: 4,
  })
  const sellFill = new Fill({
    tradeId: "testnet-sell-fill",
    brokerOrderId: canonicalSell.brokerOrderId,
    market: marketMetadata.market,
    side: "SELL",
    price: new Money({ amount: replacementSell.price, asset: marketMetadata.market.quoteAsset }),
    quantity: new Quantity({ amount: replacementSell.quantity, asset: marketMetadata.market.baseAsset }),
    quoteQuantity: new Money({
      amount: multiplyDecimal({ left: replacementSell.price, right: replacementSell.quantity }),
      asset: marketMetadata.market.quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  baseBalance = "0.001"
  userDataHandlers.onEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: canonicalSell,
      fill: sellFill,
    },
  })
  await waitForTestSignal(recoveryCompleted, "recovery.cycle_completed after the SELL fill", () => ({
    submittedOrders: submittedOrders.map(({ side, price }) => ({ side, price })),
    userDataReady: runtime.userDataReady,
    userDataStatus: runtime.userDataStatus,
    errors: runtimeErrors,
  }))
  await subscriptions.get("BTCUSDT")({
    eventType: "aggTrade",
    symbol: "BTCUSDT",
    price: "65000.12",
    timestamp: 1000,
  })
  assert.equal(submittedOrders.length, 6)
  assert.equal(submittedOrders[5].side, "BUY")
  await runtime.stop()
  const position = runtime.portfolio.getPosition({ symbol: "BTCUSDT" })
  assert.equal(position.baseQuantity.amount, "0")
  assert.equal(position.freeBaseQuantity.amount, "0.001")
  assert.equal(runtime.getRecoveryLedger({ marketId: marketMetadata.market.id }).buyCost, "0")
  assert.deepEqual(submittedOrders.map((order) => order.side), ["BUY", "SELL", "BUY", "SELL", "BUY", "BUY"])
})


test("logs each broker startup stage and key readiness actions", async () => {
  const calls = []
  const broker = createBroker()
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {
      debug: (data) => calls.push({ level: "debug", ...data }),
      info: (data) => calls.push({ level: "info", ...data }),
      error: (data) => calls.push({ level: "error", ...data }),
    },
  })

  const messages = calls.map(({ message }) => message)
  assert.ok(messages.includes("Startup step: loading and validating trading configuration"))
  assert.ok(messages.includes("Startup step: opening Binance WebSocket connection"))
  assert.ok(messages.includes("Startup step: loading exchange trading rules"))
  assert.ok(messages.includes("Startup step: opening user-data subscription"))
  assert.ok(messages.includes("Startup step: loading initial exchange account snapshot"))
  assert.ok(messages.includes("Startup step: subscribing to market prices"))
  assert.ok(messages.includes("Binance broker connected"))
  assert.ok(messages.includes("Binance user-data subscription established"))
  assert.ok(messages.includes("Exchange account snapshot loaded"))
  assert.ok(messages.includes("Harvester subscribed to market prices"))

  await result.stop()
})

test("retains an explicitly injected application event publisher in configuration-only runtime", async () => {
  const eventPublisher = { publish: () => ({ ok: true }) }
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: {},
    eventPublisher,
  })

  assert.equal(result.eventPublisher, eventPublisher)
  await result.stop()
})


test("stops broker intake before draining queued user-data and disconnects afterward", async () => {
  const calls = []
  const broker = createBroker(calls)
  const originalSubscribeForPrices = broker.subscribeForPrices.bind(broker)
  let resolveMarketUnsubscribe
  const marketUnsubscribed = new Promise((resolve) => { resolveMarketUnsubscribe = resolve })
  broker.subscribeForPrices = async (input) => {
    const result = await originalSubscribeForPrices(input)
    return {
      ...result,
      data: {
        ...result.data,
        unsubscribe: async () => {
          calls.push("unsubscribe:" + input.symbol)
          resolveMarketUnsubscribe()
          return result.data.unsubscribe()
        },
      },
    }
  }
  const originalSubscribeForUserData = broker.subscribeForUserData.bind(broker)
  let resolveUserDataUnsubscribe
  const userDataUnsubscribed = new Promise((resolve) => { resolveUserDataUnsubscribe = resolve })
  broker.subscribeForUserData = async (handlers) => {
    const result = await originalSubscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        disconnect: async () => {
          calls.push("unsubscribe:user-data")
          resolveUserDataUnsubscribe()
          return result.data.disconnect()
        },
      },
    }
  }

  let resolveQueue
  const queueGate = new Promise((resolve) => { resolveQueue = resolve })
  let signalQueueStarted
  const queueStarted = new Promise((resolve) => { signalQueueStarted = resolve })
  let queuedEvents = 0
  const runtime = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    onUserDataEvent: async () => {
      queuedEvents += 1
      calls.push("queue:start")
      signalQueueStarted()
      await queueGate
      calls.push("queue:done")
    },
  })

  broker.emitUserDataEvent({ eventType: "outboundAccountPosition" })
  await queueStarted
  const stopPromise = runtime.stop()
  await Promise.all([marketUnsubscribed, userDataUnsubscribed])

  assert.ok(calls.includes("unsubscribe:BTCUSDT"))
  assert.ok(calls.includes("unsubscribe:user-data"))
  assert.equal(calls.includes("queue:done"), false)
  assert.equal(calls.includes("disconnect"), false)

  broker.emitUserDataEvent({ eventType: "outboundAccountPosition" })
  await Promise.resolve()
  assert.equal(queuedEvents, 1)

  resolveQueue()
  await stopPromise
  assert.ok(calls.indexOf("unsubscribe:BTCUSDT") < calls.indexOf("queue:done"))
  assert.ok(calls.indexOf("unsubscribe:user-data") < calls.indexOf("queue:done"))
  assert.ok(calls.indexOf("queue:done") < calls.indexOf("disconnect"))
})


test("logs safe correlation details when an execution report is not owned", async () => {
  const broker = createBroker()
  const errors = []
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: {
      ...binanceEnv,
      HARVESTER_ENABLE_TRADING: "true",
      HARVESTER_TRADING_MODE: "testnet",
      NODE_ENV: "test",
    },
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      debug() {},
      error: (entry) => errors.push(entry),
    },
  })
  const metadata = createMarketMetadata("BTCUSDT")
  const externalOrder = new CanonicalOrder({
    clientOrderId: "external-client-id",
    brokerOrderId: "987654",
    market: metadata.market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({ amount: "65000", asset: metadata.market.quoteAsset }),
    originalQuantity: new Quantity({ amount: "0.01", asset: metadata.market.baseAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: metadata.market.baseAsset }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })

  broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "NEW",
    executionId: 123456,
    executedOrder: externalOrder,
  })
  await new Promise((resolve) => setImmediate(resolve))

  const diagnostic = errors.find((entry) =>
    entry.message === "Harvester rejected an unowned or invalid order event")
  assert.ok(diagnostic)
  assert.equal(diagnostic.symbol, "BTCUSDT")
  assert.equal(diagnostic.brokerOrderId, "987654")
  assert.equal(diagnostic.clientOrderId, "external-client-id")
  assert.equal(diagnostic.side, "BUY")
  assert.equal(diagnostic.executionType, "NEW")
  assert.equal(diagnostic.orderStatus, "OPEN")
  assert.equal(diagnostic.executionId, 123456)
  assert.equal(diagnostic.registryMatchedByClientOrderId, false)
  assert.equal(diagnostic.registryMatchedByBrokerOrderId, false)
  assert.equal(diagnostic.clientIdMatchStatus, undefined)
  assert.ok(Array.isArray(diagnostic.errors))

  await result.stop()
})


test("reconciles the in-memory order registry before reopening trading after stream recovery", async () => {
  const broker = createBroker()
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: {
      ...binanceEnv,
      HARVESTER_ENABLE_TRADING: "true",
      HARVESTER_TRADING_MODE: "testnet",
      NODE_ENV: "test",
    },
    brokerAdapterFactory: () => broker,
    logger: { info() {}, error() {} },
  })

  assert.equal(result.userDataReady, true)
  broker.emitUserDataStatus({
    type: "recovered",
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  assert.equal(result.userDataReady, false)

  broker.emitUserDataStatus({
    type: "reconciled",
    recoveryRequired: false,
    reconciliationRequired: true,
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(result.userDataReady, false)

  broker.emitUserDataStatus({
    type: "reconciled",
    recoveryRequired: false,
    reconciliationRequired: false,
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.userDataReady, true)
  assert.equal(result.userDataStatus, "READY")
  await result.stop()
})


test("fails closed when trading is explicitly enabled without selecting a broker", async () => {
  let brokerFactoryCalled = false
  await assert.rejects(
    startHarvester({
      loadConfig: async () => tradingConfig,
      env: {
        HARVESTER_ENABLE_TRADING: "true",
        HARVESTER_TRADING_MODE: "testnet",
        NODE_ENV: "test",
      },
      brokerAdapterFactory: () => {
        brokerFactoryCalled = true
        return createBroker()
      },
      logger: { info() {}, error() {} },
    }),
    /HARVESTER_BROKER=binance is required when HARVESTER_ENABLE_TRADING=true/,
  )
  assert.equal(brokerFactoryCalled, false)
})


test("normalizes only Binance Spot's definite POST-ONLY rejection", async () => {
  const client = {
    connect: async () => {}, disconnect: async () => {}, createOrder: async () => ({ ok: true }),
    cancelOrder: async () => ({ ok: true }), getOpenOrders: async () => ({ ok: true }),
    getFills: async () => ({ ok: true }), getCanonicalOrderHistory: async () => ({ ok: true }),
    getAccountSnapshot: async () => ({ ok: true }), getSymbolFilters: async () => ({ ok: true }),
    getPrices: async () => ({ ok: true }), subscribeForPrices: async () => ({ ok: true }),
    subscribeForBookTicker: async () => ({ ok: true }), subscribeForUserData: async () => ({ ok: true }),
  }
  const broker = createBinanceBrokerAdapter({
    config: { apiKey: "test-key", apiSecret: "test-secret" },
    brokerFactory: () => client,
  })
  const rejection = Object.assign(new Error("Order would immediately match and take."), { code: -2010 })
  client.createCanonicalOrder = async () => ({ ok: false, errors: [rejection] })
  const result = await broker.placeOrder({ order: { symbol: "BTCUSDT", type: "LIMIT_MAKER" } })
  assert.equal(result.errors[0].code, "POST_ONLY_WOULD_TAKE")
  const unrelated = Object.assign(new Error("insufficient balance"), { code: -2010 })
  client.createCanonicalOrder = async () => ({ ok: false, errors: [unrelated] })
  const other = await broker.placeOrder({ order: { symbol: "BTCUSDT", type: "LIMIT_MAKER" } })
  assert.equal(other.errors[0], unrelated)

  const unknownOutcome = Object.assign(
    new Error("Order would immediately match and take."),
    { code: -2010, outcomeUnknown: true },
  )
  client.createCanonicalOrder = async () => ({ ok: false, errors: [unknownOutcome] })
  const unknown = await broker.placeOrder({ order: { symbol: "BTCUSDT", type: "LIMIT_MAKER" } })
  assert.equal(unknown.errors[0], unknownOutcome)

  let forwardedSubscription
  const onBookTicker = () => {}
  client.subscribeForBookTicker = async (input) => {
    forwardedSubscription = input
    return { ok: true, data: { unsubscribe: async () => {} } }
  }
  await broker.subscribeForBookTicker({ symbol: "BTCUSDT", onBookTicker })
  assert.equal(forwardedSubscription.symbol, "BTCUSDT")
  assert.equal(forwardedSubscription.onBookTicker, onBookTicker)
})

