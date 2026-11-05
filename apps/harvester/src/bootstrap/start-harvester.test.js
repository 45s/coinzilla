import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Balance, CanonicalOrder, Fill, Market, Money, Quantity, TradingRules } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { multiplyDecimal } from "@coinzilla/utils"
import { startHarvester } from "./start-harvester.js"
const testEventPublisher = Object.freeze({
  publish: () => ({ ok: true }),
  flush: async () => ({ ok: true, durable: true }),
})
const startHarvesterForTest = (input = {}) => {
  const eventPublisher = input.eventPublisher
    ? input.env?.HARVESTER_ENABLE_TRADING === "true" && typeof input.eventPublisher.flush !== "function"
      ? { ...input.eventPublisher, flush: testEventPublisher.flush }
      : input.eventPublisher
    : testEventPublisher
  return startHarvester({ ...input, eventPublisher })
}

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
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: { minProfit: 0.01, conservative: { enabled: true }, aggressive: { enabled: false } },
      pairs: {
        BTCUSDT: {
          enabled: true, investment: 100, orderQuantity: 0.01, keepQuantity: 0.001,
          priceStepPercent: 0.05, pricePrecision: 2, quantityPrecision: 3,
          makerPercent: 0, takerPercent: 0,
        },
        ETHUSDT: {
          enabled: false, investment: 100, orderQuantity: 0.1, keepQuantity: 0.001,
          priceStepPercent: 0.05, pricePrecision: 2, quantityPrecision: 3,
          makerPercent: 0, takerPercent: 0,
        },
      },
    },
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
    getOpenOrders: async () => ({ ok: true, data: [] }),
    getFills: async () => ({ ok: true }),
    getCanonicalOrderHistory: async () => ({ ok: true, data: [] }),
    getCanonicalOrder: async () => ({ ok: false, errors: [new Error("order not found")] }),
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
  const result = await startHarvesterForTest({ loadConfig: async () => tradingConfig, env: {} })
  assert.equal(result.tradingConfig, tradingConfig)
  assert.equal(result.broker, undefined)
  assert.equal(result.connected, false)
  assert.ok(result.portfolio instanceof Portfolio)
  await result.stop()
})

test("rejects enabling the deferred Aggressive strategy in trading config", async () => {
  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => ({ ...tradingConfig, strategies: { ...tradingConfig.strategies, CG_coinGrabber: { ...tradingConfig.strategies.CG_coinGrabber, settings: { ...tradingConfig.strategies.CG_coinGrabber.settings, aggressive: { enabled: true } } } } }),
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
  const result = await startHarvesterForTest({
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
  assert.ok(result.recoveredState)
  assert.equal(result.recoveredState.requiresExchangeReconciliation, false)
  assert.deepEqual(result.recoveredState.pausedMarkets, new Set())
  assert.equal(result.recoveredState.orderRegistry.orders.length, 0)
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
  assert.equal(strategyCalls[0].pairConfig, tradingConfig.strategies.CG_coinGrabber.pairs.BTCUSDT)
  assert.equal(strategyCalls[0].settings, tradingConfig.strategies.CG_coinGrabber.settings)
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
  const result = await startHarvesterForTest({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: { info() {}, error() {} },
  })
  const decision = await result.processMarketPrice({
    symbol: "BTCUSDT",
    priceEvent: { symbol: "BTCUSDT", price: "65000.12", timestamp: 123 },
    pairConfig: tradingConfig.strategies.CG_coinGrabber.pairs.BTCUSDT,
    settings: tradingConfig.strategies.CG_coinGrabber.settings,
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
    pairConfig: tradingConfig.strategies.CG_coinGrabber.pairs.BTCUSDT,
    settings: tradingConfig.strategies.CG_coinGrabber.settings,
  })
  assert.equal(nextDecision.data.decision.position.baseQuantity.amount, "0.01")
  await result.stop()
})

test("serializes concurrent Portfolio updates without losing fills", async () => {
  const result = await startHarvesterForTest({ loadConfig: async () => tradingConfig, env: {} })
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
    startHarvesterForTest({
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
    strategies: {
      ...tradingConfig.strategies,
      CG_coinGrabber: {
        ...tradingConfig.strategies.CG_coinGrabber,
        pairs: {
          ...tradingConfig.strategies.CG_coinGrabber.pairs,
          ETHUSDT: { enabled: true, investment: 100, orderQuantity: 0.1, makerPercent: 0, takerPercent: 0 },
        },
      },
    },
  }
  await assert.rejects(
    startHarvesterForTest({
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
    startHarvesterForTest({ loadConfig: async () => tradingConfig, env: { HARVESTER_BROKER: "unknown" } }),
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
    startHarvesterForTest({
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
  const result = await startHarvesterForTest({
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
    startHarvesterForTest({
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
    startHarvesterForTest({
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
  const result = await startHarvesterForTest({
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

  const result = await startHarvesterForTest({
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
  const result = await startHarvesterForTest({
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
  const result = await startHarvesterForTest({
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
    startHarvesterForTest({
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
  const result = await startHarvesterForTest({
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
  const result = await startHarvesterForTest({
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
    startHarvesterForTest({
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
    startHarvesterForTest({
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
  const result = await startHarvesterForTest({
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
    startHarvesterForTest({
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
  const result = await startHarvesterForTest({
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
  const runtimeDebug = []
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
    getCanonicalOrder: async () => ({ ok: false, errors: [new Error("order not found")] }),
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
    strategies: {
      CG_coinGrabber: {
        enabled: true,
        settings: { minProfit: 0.01, conservative: { enabled: true }, aggressive: { enabled: false } },
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
    },
    },
  }
  const runtime = await startHarvesterForTest({
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
      debug: (entry) => runtimeDebug.push(entry),
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
  const clientOrderId = submittedOrders[0].clientOrderId
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
    clientOrderId: canonicalBuy.clientOrderId,
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
    clientOrderId: canonicalSecondBuy.clientOrderId,
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
    clientOrderId: canonicalSell.clientOrderId,
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
  assert.ok(runtimeDebug.some(({ message, tradeId }) =>
    message === "Harvester accounting execution applied" && tradeId === "testnet-buy-fill"))
  assert.ok(runtimeDebug.some(({ message, tradeId }) =>
    message === "Harvester accounting execution applied" && tradeId === "testnet-sell-fill"))
  assert.ok(runtimeDebug.some(({ message }) =>
    message === "Harvester recovery completion evaluation input"))
  assert.ok(runtimeDebug.some(({ message }) =>
    message === "Harvester recovery cycle completed and inventory allocated"))
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
  assert.equal(position.baseQuantity.amount, "0.001")
  assert.equal(position.freeBaseQuantity.amount, "0.001")
  assert.equal(runtime.getRecoveryLedger({ marketId: marketMetadata.market.id }).buyCost, "0")
  assert.deepEqual(submittedOrders.map((order) => order.side), ["BUY", "SELL", "BUY", "SELL", "BUY", "BUY"])
})


test("logs readiness at info and traces Conservative strategy input and decision at debug level", async () => {
  const calls = []
  const broker = createBroker()
  broker.getOpenOrders = async () => ({ ok: true, data: [] })
  const result = await startHarvesterForTest({
    loadConfig: async () => tradingConfig,
    env: { ...binanceEnv, HARVESTER_ENABLE_TRADING: "true", HARVESTER_TRADING_MODE: "testnet", NODE_ENV: "test" },
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    now: () => 123,
    logger: {
      debug: (data) => calls.push({ level: "debug", ...data }),
      info: (data) => calls.push({ level: "info", ...data }),
      error: (data) => calls.push({ level: "error", ...data }),
    },
  })

  await broker.emitUserDataStatus({ type: "reconciled", recoveryRequired: false })
  await broker.emitPrice("BTCUSDT", {
    eventType: "aggTrade",
    symbol: "BTCUSDT",
    price: "65000.12",
    timestamp: 123,
  })
  await broker.emitBookTicker("BTCUSDT", {
    symbol: "BTCUSDT",
    bestBidPrice: "65000.11",
    bestBidQuantity: "1",
    bestAskPrice: "65000.13",
    bestAskQuantity: "1",
    timestamp: 123,
  })
  const infoCalls = calls.filter(({ level }) => level === "info")
  const infoMessages = infoCalls.map(({ message }) => message)
  const marketEvaluations = infoCalls.filter(({ message }) => message === "Market price evaluated")
  const targetMarketEvaluation = marketEvaluations.find(({ price }) => price === "65000.12")
  assert.ok(marketEvaluations.length >= 1)
  assert.ok(targetMarketEvaluation)
  assert.equal(targetMarketEvaluation.level, "info")
  assert.equal(targetMarketEvaluation.message, "Market price evaluated")
  assert.equal(targetMarketEvaluation.symbol, "BTCUSDT")
  assert.equal(targetMarketEvaluation.price, "65000.12")
  assert.ok(typeof targetMarketEvaluation.action === "string" && targetMarketEvaluation.action.length > 0)
  assert.notEqual(targetMarketEvaluation.action, "UNKNOWN")
  assert.ok(infoMessages.includes("Harvester trading configuration validated"))
  assert.ok(infoMessages.includes("Binance broker connected"))
  assert.ok(infoMessages.includes("Exchange trading rules validated"))
  assert.ok(infoMessages.includes("Binance user-data subscription established"))
  assert.ok(infoMessages.includes("Exchange account snapshot loaded"))
  assert.ok(infoMessages.includes("Conservative TESTNET trading engine activated"))
  assert.ok(infoMessages.includes("Harvester subscribed to book ticker"))
  assert.ok(infoMessages.includes("Harvester subscribed to market prices"))
  const debugCalls = calls.filter(({ level }) => level === "debug")
  const marketEvent = debugCalls.find(({ message, price }) =>
    message === "Harvester market price event received" && price === "65000.12")
  const evaluationStarted = debugCalls.find(({ message, marketEventId }) =>
    message === "Harvester Conservative evaluation started" &&
    marketEventId === marketEvent?.marketEventId)
  const evaluationDecided = debugCalls.find(({ message, evaluationId }) =>
    message === "Harvester Conservative evaluation decided" &&
    evaluationId === evaluationStarted?.evaluationId)
  assert.ok(marketEvent)
  assert.ok(evaluationStarted)
  assert.ok(evaluationDecided)
  assert.equal(marketEvent.symbol, "BTCUSDT")
  assert.equal(marketEvent.price, "65000.12")
  assert.equal(evaluationStarted.marketEventId, marketEvent.marketEventId)
  assert.equal(evaluationStarted.symbol, "BTCUSDT")
  assert.equal(evaluationStarted.marketPrice.price, "65000.12")
  assert.equal(evaluationStarted.lastBuyPrice, null)
  assert.deepEqual(evaluationStarted.activeOrders, [])
  assert.ok(Array.isArray(evaluationStarted.portfolio.positions))
  assert.equal(evaluationDecided.evaluationId, evaluationStarted.evaluationId)
  assert.ok(Array.isArray(evaluationDecided.actions))

  await result.stop()
})

test("retains an explicitly injected application event publisher in configuration-only runtime", async () => {
  const eventPublisher = { publish: () => ({ ok: true }) }
  const result = await startHarvesterForTest({
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
  let resolveBookUnsubscribe
  const bookUnsubscribed = new Promise((resolve) => { resolveBookUnsubscribe = resolve })
  const originalSubscribeForBookTicker = broker.subscribeForBookTicker.bind(broker)
  broker.subscribeForBookTicker = async (input) => {
    const result = await originalSubscribeForBookTicker(input)
    return {
      ...result,
      data: {
        ...result.data,
        unsubscribe: async () => {
          calls.push("unsubscribe:book:" + input.symbol)
          resolveBookUnsubscribe()
          return result.data.unsubscribe()
        },
      },
    }
  }
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
  const runtime = await startHarvesterForTest({
    loadConfig: async () => tradingConfig,
    env: { ...binanceEnv, HARVESTER_ENABLE_TRADING: "true", HARVESTER_TRADING_MODE: "testnet", NODE_ENV: "test" },
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
  await Promise.all([bookUnsubscribed, marketUnsubscribed, userDataUnsubscribed])

  assert.ok(calls.includes("unsubscribe:book:BTCUSDT"))
  assert.ok(calls.includes("unsubscribe:BTCUSDT"))
  assert.ok(calls.includes("unsubscribe:user-data"))
  assert.equal(calls.includes("queue:done"), false)
  assert.equal(calls.includes("disconnect"), false)

  broker.emitUserDataEvent({ eventType: "outboundAccountPosition" })
  await Promise.resolve()
  assert.equal(queuedEvents, 1)

  resolveQueue()
  await stopPromise
  assert.ok(calls.indexOf("unsubscribe:book:BTCUSDT") < calls.indexOf("queue:done"))
  assert.ok(calls.indexOf("unsubscribe:BTCUSDT") < calls.indexOf("queue:done"))
  assert.ok(calls.indexOf("unsubscribe:user-data") < calls.indexOf("queue:done"))
  assert.ok(calls.indexOf("queue:done") < calls.indexOf("disconnect"))
})


test("logs safe correlation details when an execution report is not owned", async () => {
  const broker = createBroker()
  const errors = []
  const result = await startHarvesterForTest({
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
  const result = await startHarvesterForTest({
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
    startHarvesterForTest({
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
    cancelOrder: async () => ({ ok: true }), getOpenOrders: async () => ({ ok: true, data: [] }),
    getFills: async () => ({ ok: true }), getCanonicalOrderHistory: async () => ({ ok: true }), getCanonicalOrder: async () => ({ ok: false, errors: [new Error("order not found")] }),
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



test("emits per-execution debug audit records with commission and before/after accounting", async () => {
  const debugRecords = []
  const result = await startHarvesterForTest({
    loadConfig: async () => tradingConfig,
    env: {},
    logger: {
      info() {},
      error() {},
      debug(record) { debugRecords.push(record) },
    },
  })

  const fill = createFill({ tradeId: "audited-trade", quantity: "0.01" })
  const applied = await result.updateTradingAccounting({ fill })

  assert.equal(applied.ok, true)
  const received = debugRecords.find((record) =>
    record.message === "Harvester accounting execution received")
  const committed = debugRecords.find((record) =>
    record.message === "Harvester accounting execution applied")

  assert.equal(received.executionId, fill.id)
  assert.equal(received.tradeId, "audited-trade")
  assert.equal(received.symbol, "BTCUSDT")
  assert.equal(received.side, "BUY")
  assert.equal(received.liquidityRole, "UNKNOWN")
  assert.equal(received.executedAt, undefined)
  assert.equal(received.quantity, "0.01")
  assert.equal(received.quoteQuantity, "650")
  assert.equal(received.commissionStatus, "COMPLETE")
  assert.deepEqual(received.commissions, [])
  assert.equal(received.previousRecoveryLedger.buyCost, "0")
  assert.equal(committed.applied, true)
  assert.equal(committed.duplicate, false)
  assert.equal(committed.nextRecoveryLedger.buyCost, "650")
  assert.equal(committed.nextRecoveryLedger.netSellProceeds, "0")
  assert.equal(committed.accountingDelta.portfolioActiveBase, "0.01")
  assert.equal(committed.accountingDelta.buyCost, "650")
  assert.equal(committed.accountingDelta.netSellProceeds, "0")
  assert.equal(committed.accountingDelta.outstandingRecoveryAmount, "650")
  assert.equal(committed.accountingDelta.realizedNetProfit, "-650")

  await result.stop()
})


test("disconnects after a CLOSING snapshot durability failure and reports shutdown incomplete", async () => {
  const calls = []
  const broker = createBroker(calls)
  const events = []
  let flushCount = 0
  const runtime = await startHarvesterForTest({
    loadConfig: async () => tradingConfig,
    env: { ...binanceEnv, HARVESTER_ENABLE_TRADING: "true", HARVESTER_TRADING_MODE: "testnet", NODE_ENV: "test" },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => { events.push(event); return { ok: true } },
      flush: async () => {
        flushCount += 1
        calls.push("journal:flush:" + flushCount)
        return flushCount < 3
          ? { ok: true, durable: true }
          : { ok: false, errors: [new Error("closing snapshot fsync failed")] }
      },
    },
    now: () => 1000,
    logger: { info() {}, error() {}, debug() {} },
  })

  await assert.rejects(runtime.stop(), /Harvester shutdown was incomplete/)

  const snapshots = events.filter((event) => event.name === "account.snapshot_captured")
  assert.equal(flushCount, 3)
  assert.equal(snapshots.length, 2)
  assert.equal(snapshots[0].data.phase, "PREFLIGHT")
  assert.equal(snapshots[1].data.phase, "CLOSING")
  assert.ok(calls.indexOf("disconnect") > calls.lastIndexOf("account:snapshot"))
  assert.equal(calls.includes("disconnect"), true)
})

test("marks CLOSING account audit INCOMPLETE when owned-order REST reconciliation fails", async () => {
  const calls = []
  const broker = createBroker(calls)
  const events = []
  const btcMarket = createMarketMetadata("BTCUSDT").market
  let releaseOpenOrders
  let signalOpenOrdersStarted
  const openOrdersGate = new Promise((resolve) => { releaseOpenOrders = resolve })
  const openOrdersStarted = new Promise((resolve) => { signalOpenOrdersStarted = resolve })
  broker.getOpenOrders = async ({ symbol } = {}) => {
    if (symbol === undefined) return { ok: true, data: [] }
    signalOpenOrdersStarted()
    await openOrdersGate
    return { ok: true }
  }
  broker.placeOrder = async ({ order }) => {
    calls.push("placeOrder:" + order.side)
    return {
      ok: true,
      data: new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: "broker-" + order.clientOrderId,
        market: btcMarket,
        side: order.side,
        type: order.type,
        limitPrice: new Money({ amount: order.price, asset: btcMarket.quoteAsset }),
        originalQuantity: new Quantity({ amount: order.quantity, asset: btcMarket.baseAsset }),
        executedQuantity: new Quantity({ amount: "0", asset: btcMarket.baseAsset }),
        status: "OPEN",
        createdAt: 1,
        acknowledgedAt: 1,
        updatedAt: 1,
      }),
    }
  }
  const config = {
    ...tradingConfig,
    strategies: {
      ...tradingConfig.strategies,
      CG_coinGrabber: {
        ...tradingConfig.strategies.CG_coinGrabber,
        pairs: {
          ...tradingConfig.strategies.CG_coinGrabber.pairs,
          BTCUSDT: {
            ...tradingConfig.strategies.CG_coinGrabber.pairs.BTCUSDT,
            investment: 2000,
          },
        },
      },
    },
  }
  const runtime = await startHarvesterForTest({
    loadConfig: async () => config,
    env: { ...binanceEnv, HARVESTER_ENABLE_TRADING: "true", HARVESTER_TRADING_MODE: "testnet", NODE_ENV: "test" },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => { events.push(event); return { ok: true } },
      flush: async () => ({ ok: true, durable: true }),
    },
    now: () => 1000,
    logger: { info() {}, error() {}, debug() {} },
  })

  await broker.emitBookTicker("BTCUSDT", {
    symbol: "BTCUSDT",
    bestBidPrice: "64999",
    bestBidQuantity: "1",
    bestAskPrice: "65001",
    bestAskQuantity: "1",
    timestamp: 1000,
  })
  await broker.emitPrice("BTCUSDT", {
    symbol: "BTCUSDT",
    price: "65000",
    timestamp: 1000,
  })
  assert.ok(calls.includes("placeOrder:BUY"))

  const stopPromise = runtime.stop()
  await openOrdersStarted
  assert.equal(events.filter((event) => event.name === "account.snapshot_captured").length, 1)
  assert.equal(calls.includes("disconnect"), false)
  releaseOpenOrders()
  await stopPromise

  const snapshots = events.filter((event) => event.name === "account.snapshot_captured")
  assert.equal(snapshots.length, 2)
  assert.equal(snapshots[1].data.phase, "CLOSING")
  assert.equal(snapshots[1].data.auditStatus, "INCOMPLETE")
  assert.ok(snapshots[1].data.auditReasons.includes("OWNED_ORDER_RECONCILIATION_FAILED"))
  assert.ok(snapshots[1].data.auditReasons.includes("UNRESOLVED_OWNED_ORDERS:1"))
  assert.ok(calls.indexOf("disconnect") > calls.lastIndexOf("account:snapshot"))
})

test("journals PREFLIGHT balances and open orders before trading and CLOSING balances before broker disconnect", async () => {
  const calls = []
  const broker = createBroker(calls)
  let openOrderReads = 0
  const getOpenOrders = broker.getOpenOrders
  broker.getOpenOrders = async (input) => {
    openOrderReads += 1
    assert.deepEqual(input, {})
    return getOpenOrders(input)
  }
  const events = []
  const eventPublisher = {
    publish: (event) => {
      events.push(event)
      calls.push("publish:" + event.name)
      return { ok: true }
    },
    flush: async () => {
      calls.push("journal:flush")
      return { ok: true, durable: true }
    },
  }
  const runtime = await startHarvesterForTest({
    loadConfig: async () => tradingConfig,
    env: { ...binanceEnv, HARVESTER_ENABLE_TRADING: "true", HARVESTER_TRADING_MODE: "testnet", NODE_ENV: "test" },
    brokerAdapterFactory: () => broker,
    eventPublisher,
    logger: { info() {}, error() {}, debug() {} },
  })

  const openingEvent = events.find((event) => event.name === "account.snapshot_captured")
  assert.equal(calls.filter((call) => call === "account:snapshot").length, 1)
  assert.equal(openOrderReads, 1)
  assert.equal(events.filter((event) => event.name === "account.snapshot_captured" && event.data.phase === "PREFLIGHT").length, 1)
  assert.equal(events.filter((event) => event.name === "account.open_orders_captured" && event.data.phase === "PREFLIGHT").length, 1)
  assert.equal(openingEvent.data.phase, "PREFLIGHT")
  const openOrdersEvent = events.find((event) => event.name === "account.open_orders_captured")
  assert.equal(openOrdersEvent.data.readiness, "READY")
  assert.equal(openOrdersEvent.data.orderCount, 0)
  assert.deepEqual(openOrdersEvent.data.orders, [])
  assert.equal(openingEvent.data.auditStatus, "COMPLETE")
  assert.ok(openingEvent.data.balances.some((balance) => balance.asset === "BTC"))
  assert.ok(openingEvent.data.balances.some((balance) => balance.asset === "USDT"))
  const openingPublishIndex = calls.indexOf("publish:account.snapshot_captured")
  const openingFlushIndex = calls.indexOf("journal:flush")
  const firstMarketSubscriptionIndex = calls.findIndex((call) => call.startsWith("subscribe:book:"))
  assert.ok(openingPublishIndex >= 0)
  assert.ok(openingFlushIndex > openingPublishIndex)
  assert.ok(firstMarketSubscriptionIndex > calls.lastIndexOf("journal:flush"))

  await runtime.stop()

  const snapshotEvents = events.filter((event) => event.name === "account.snapshot_captured")
  assert.equal(snapshotEvents.length, 2)
  assert.equal(snapshotEvents[1].data.phase, "CLOSING")
  assert.equal(snapshotEvents[1].data.auditStatus, "COMPLETE")
  const closingFlushIndex = calls.lastIndexOf("journal:flush")
  const disconnectIndex = calls.indexOf("disconnect")
  assert.ok(closingFlushIndex >= 0)
  assert.ok(disconnectIndex > closingFlushIndex)
})


test("fails startup before market subscriptions when PREFLIGHT account snapshot cannot be durably flushed", async () => {
  const calls = []
  const broker = createBroker(calls)
  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => tradingConfig,
    env: { ...binanceEnv, HARVESTER_ENABLE_TRADING: "true", HARVESTER_TRADING_MODE: "testnet", NODE_ENV: "test" },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: () => ({ ok: true }),
      flush: async () => ({ ok: false, errors: [new Error("fsync failed")] }),
    },
    logger: { info() {}, error() {}, debug() {} },
  }), /Unable to durably persist PREFLIGHT account snapshot/)
  assert.ok(calls.includes("disconnect"))
  assert.equal(calls.some((call) => call.startsWith("subscribe:book:")), false)
  assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false)
})


test("journals account-wide open orders and blocks trading before engine activation when any exist", async () => {
  const calls = []
  const broker = createBroker(calls)
  const events = []
  broker.getOpenOrders = async (input = {}) => {
    calls.push("open-orders:account-wide:" + String(input.symbol))
    return {
      ok: true,
      data: [{
        clientOrderId: "manual-zro-sell",
        id: "699694",
        symbol: "ZROUSDT",
        side: "SELL",
        type: "LIMIT",
        originalPrice: "1.82800000",
        originalQuantity: "4.98000000",
        executedQuantity: "0.00000000",
        status: "NEW",
      }],
    }
  }
  const eventPublisher = {
    publish: (event) => { events.push(event); return { ok: true } },
    flush: async () => ({ ok: true, durable: true }),
  }
  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => ({
      ...tradingConfig,
      strategies: {
        ...tradingConfig.strategies,
        CG_coinGrabber: {
          ...tradingConfig.strategies.CG_coinGrabber,
          pairs: {
            ...tradingConfig.strategies.CG_coinGrabber.pairs,
            BTCUSDT: { ...tradingConfig.strategies.CG_coinGrabber.pairs.BTCUSDT, enabled: true },
          },
        },
      },
    }),
    env: { ...binanceEnv, HARVESTER_ENABLE_TRADING: "true", HARVESTER_TRADING_MODE: "testnet", NODE_ENV: "test" },
    brokerAdapterFactory: () => broker,
    eventPublisher,
    logger: { info() {}, error() {}, debug() {} },
  }), /startup blocked: account has 1 open order/)

  const openingBalances = events.find((event) => event.name === "account.snapshot_captured")
  const openOrders = events.find((event) => event.name === "account.open_orders_captured")
  assert.equal(openingBalances.data.phase, "PREFLIGHT")
  assert.equal(openOrders.data.readiness, "BLOCKED")
  assert.equal(openOrders.data.orderCount, 1)
  assert.equal(openOrders.data.orders[0].brokerOrderId, "699694")
  assert.ok(calls.includes("open-orders:account-wide:undefined"))
  assert.equal(calls.some((call) => call.startsWith("subscribe:book:")), false)
  assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false)
  assert.ok(calls.includes("disconnect"))
})


test("fails closed before market subscriptions when the account-wide open-order query fails", async () => {
  const calls = []
  const broker = createBroker(calls)
  const events = []
  broker.getOpenOrders = async () => ({
    ok: false,
    errors: [new Error("Binance openOrders.status unavailable")],
  })
  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => tradingConfig,
    env: { ...binanceEnv, HARVESTER_ENABLE_TRADING: "true", HARVESTER_TRADING_MODE: "testnet", NODE_ENV: "test" },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => { events.push(event); return { ok: true } },
      flush: async () => ({ ok: true, durable: true }),
    },
    logger: { info() {}, error() {}, debug() {} },
  }), /Unable to load authoritative account-wide open orders/)
  assert.ok(events.some((event) => event.name === "account.snapshot_captured"))
  assert.equal(events.some((event) => event.name === "account.open_orders_captured"), false)
  assert.equal(calls.some((call) => call.startsWith("subscribe:book:")), false)
  assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false)
  assert.ok(calls.includes("disconnect"))
})

 
test("captures and durably journals balances and account-wide open orders on read-only startup", async () => {
  const calls = []
  const broker = createBroker(calls)
  let accountReads = 0
  let openOrderReads = 0
  broker.getAccountSnapshot = async () => {
    accountReads += 1
    calls.push("account:snapshot")
    return {
      ok: true,
      data: {
        balances: ["BTC", "ETH", "USDT"].map((code) => {
          const asset = new Asset({ id: "asset:" + code, code })
          return new Balance({
            free: new Quantity({ amount: "12.5", asset }),
            locked: new Quantity({ amount: "0.5", asset }),
          })
        }),
        sourceTime: 123,
      },
    }
  }
  broker.getOpenOrders = async (input) => {
    openOrderReads += 1
    calls.push("account:open-orders")
    assert.deepEqual(input, {})
    return { ok: true, data: [] }
  }
  const events = []
  let flushCount = 0
  const runtime = await startHarvesterForTest({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => {
        events.push(event)
        calls.push("publish:" + event.name)
        return { ok: true }
      },
      flush: async () => {
        flushCount += 1
        calls.push("journal:flush:" + flushCount)
        return { ok: true, durable: true }
      },
    },
    logger: { info() {}, error() {}, debug() {} },
  })

  assert.equal(accountReads, 1)
  assert.equal(openOrderReads, 1)
  assert.equal(flushCount, 2)
  const balances = events.filter((event) => event.name === "account.snapshot_captured")
  const openOrders = events.filter((event) => event.name === "account.open_orders_captured")
  assert.equal(balances.length, 1)
  assert.equal(openOrders.length, 1)
  assert.equal(balances[0].data.phase, "PREFLIGHT")
  assert.equal(openOrders[0].data.phase, "PREFLIGHT")
  assert.equal(openOrders[0].data.readiness, "READY")
  assert.equal(balances[0].data.balances.find((item) => item.asset === "BTC").total, "13")
  const lastAuditFlush = calls.lastIndexOf("journal:flush:2")
  const marketSubscription = calls.findIndex((call) => call === "subscribe:BTCUSDT")
  assert.ok(lastAuditFlush >= 0)
  assert.ok(marketSubscription > lastAuditFlush)

  await runtime.stop()
})

test("records pre-existing account-wide orders in read-only mode without adopting or changing them", async () => {
  const calls = []
  const broker = createBroker(calls)
  let cancelCalls = 0
  let placeCalls = 0
  broker.getOpenOrders = async () => ({
    ok: true,
    data: [{
      id: "external-order-77",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      originalPrice: "65000.12",
      originalQuantity: "0.01",
      executedQuantity: "0",
      status: "NEW",
    }],
  })
  broker.cancelOrder = async () => { cancelCalls += 1; return { ok: true } }
  broker.placeOrder = async () => { placeCalls += 1; return { ok: true } }
  const events = []
  const runtime = await startHarvesterForTest({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => { events.push(event); return { ok: true } },
      flush: async () => ({ ok: true, durable: true }),
    },
    logger: { info() {}, error() {}, debug() {} },
  })

  const audit = events.find((event) => event.name === "account.open_orders_captured")
  assert.equal(audit.data.readiness, "BLOCKED")
  assert.deepEqual(audit.data.blockReasons, ["UNOWNED_OPEN_ORDERS:1"])
  assert.equal(audit.data.orders[0].brokerOrderId, "external-order-77")
  assert.equal(cancelCalls, 0)
  assert.equal(placeCalls, 0)
  assert.equal(runtime.connected, true)

  await runtime.stop()
})

test("blocks read-only startup when either account audit query fails", async () => {
  for (const failure of ["balances", "open-orders"]) {
    const calls = []
    const broker = createBroker(calls)
    if (failure === "balances") {
      broker.getAccountSnapshot = async () => ({ ok: false, errors: [new Error("account status failed")] })
    } else {
      broker.getOpenOrders = async () => ({ ok: false, errors: [new Error("open orders status failed")] })
    }

    await assert.rejects(startHarvesterForTest({
      loadConfig: async () => tradingConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: { info() {}, error() {}, debug() {} },
    }), failure === "balances"
      ? /Unable to load canonical exchange account balances/
      : /Unable to load authoritative account-wide open orders/)
    assert.equal(calls.includes("disconnect"), true)
    assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false)
  }
})

test("blocks read-only startup when either PREFLIGHT audit event cannot be durably flushed", async () => {
  for (const scenario of [{ failedFlush: 1, nonDurable: false }, { failedFlush: 1, nonDurable: true }, { failedFlush: 2, nonDurable: true }]) {
    const { failedFlush, nonDurable } = scenario
    const calls = []
    const broker = createBroker(calls)
    const events = []
    let flushCount = 0
    await assert.rejects(startHarvesterForTest({
      loadConfig: async () => tradingConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      eventPublisher: {
        publish: (event) => { events.push(event); return { ok: true } },
        flush: async () => {
          flushCount += 1
          if (flushCount !== failedFlush) return { ok: true, durable: true }
          return nonDurable
            ? { ok: true, durable: false }
            : { ok: false, errors: [new Error("journal fsync failed")] }
        },
      },
      logger: { info() {}, error() {}, debug() {} },
    }), failedFlush === 1
      ? /Unable to durably persist PREFLIGHT account snapshot/
      : /Unable to durably persist account open-orders audit/)
    assert.equal(events.some((event) => event.name === "account.snapshot_captured"), true)
    if (failedFlush === 2) {
      assert.equal(events.some((event) => event.name === "account.open_orders_captured"), true)
    }
    assert.equal(calls.includes("disconnect"), true)
    assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false)
  }
})


test("blocks read-only startup when either PREFLIGHT audit event publication fails", async () => {
  for (const failedEvent of ["account.snapshot_captured", "account.open_orders_captured"]) {
    const calls = []
    const broker = createBroker(calls)
    const events = []
    await assert.rejects(startHarvesterForTest({
      loadConfig: async () => tradingConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      eventPublisher: {
        publish: (event) => {
          events.push(event)
          return event.name === failedEvent
            ? { ok: false, errors: [new Error("event publication rejected")] }
            : { ok: true }
        },
        flush: async () => ({ ok: true, durable: true }),
      },
      logger: { info() {}, error() {}, debug() {} },
    }), failedEvent === "account.snapshot_captured"
      ? /Unable to publish PREFLIGHT account snapshot audit event/
      : /Unable to publish account open-orders audit event/)
    assert.equal(calls.includes("disconnect"), true)
    assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false)
  }
})


test("rejects malformed durable Journal recovery before user-data subscription", async () => {
  const calls = []
  const broker = createBroker(calls)

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => tradingConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      journalRecoveryRecords: [{
        id: "bad-recovery-record",
        payload: {
          id: "bad-recovery-record",
          name: "order.submission_requested",
          data: { clientOrderId: "missing-required-order-fields" },
        },
        position: { fileName: "session.jsonl", lineNumber: 1 },
      }],
      logger: { info() {}, error() {} },
    }),
    /Journal recovery projection failed/,
  )

  assert.deepEqual(calls, ["connect", "disconnect"])
})


test("blocks trading in bootstrap itself when validated Journal history requires exchange reconciliation", async () => {
  const calls = []
  const broker = createBroker(calls)

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => tradingConfig,
      env: {
        ...binanceEnv,
        HARVESTER_ENABLE_TRADING: "true",
        HARVESTER_TRADING_MODE: "testnet",
        NODE_ENV: "test",
      },
      brokerAdapterFactory: () => broker,
      journalRecoveryRecords: [{
        id: "prior-submission",
        payload: {
          id: "prior-submission",
          name: "order.submission_requested",
          data: {
            clientOrderId: "h-BTCUSDT-recovered-1",
            symbol: "BTCUSDT",
            side: "BUY",
            type: "LIMIT",
            price: "65000",
            quantity: "0.01",
            status: "PENDING",
          },
        },
        position: { fileName: "session.jsonl", lineNumber: 1 },
      }],
      logger: { info() {}, error() {} },
    }),
    /recovered Journal history requires canonical exchange order\/fill and account-reservation reconciliation/,
  )

  assert.deepEqual(calls, ["connect", "filters:BTCUSDT", "disconnect"])
})


test("restores and reconciles a prior filled order before opening trading readiness", async () => {
  const calls = []
  const broker = createBroker(calls)
  const market = createMarketMetadata("BTCUSDT").market
  const recoveredFill = new Fill({
    tradeId: "restart-trade-1",
    brokerOrderId: "9001",
    clientOrderId: "h-BTCUSDT-buy-1",
    market,
    side: "BUY",
    price: new Money({ amount: "65000", asset: market.quoteAsset }),
    quantity: new Quantity({ amount: "0.01", asset: market.baseAsset }),
    quoteQuantity: new Money({ amount: "650", asset: market.quoteAsset }),
    liquidityRole: "MAKER",
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const canonicalOrder = new CanonicalOrder({
    clientOrderId: "h-BTCUSDT-buy-1",
    brokerOrderId: "9001",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({ amount: "65000", asset: market.quoteAsset }),
    originalQuantity: new Quantity({ amount: "0.01", asset: market.baseAsset }),
    executedQuantity: new Quantity({ amount: "0.01", asset: market.baseAsset }),
    status: "FILLED",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 102,
    completedAt: 102,
  })
  let accountSourceTime = 2000
  broker.getAccountSnapshot = async () => ({
    ok: true,
    data: {
      sourceTime: accountSourceTime++,
      balances: [
        new Balance({
          free: new Quantity({ amount: "1000.01", asset: market.baseAsset }),
          locked: new Quantity({ amount: "0", asset: market.baseAsset }),
        }),
        new Balance({
          free: new Quantity({ amount: "1000", asset: new Asset({ id: "asset:ETH", code: "ETH" }) }),
          locked: new Quantity({ amount: "0", asset: new Asset({ id: "asset:ETH", code: "ETH" }) }),
        }),
        new Balance({
          free: new Quantity({ amount: "350", asset: market.quoteAsset }),
          locked: new Quantity({ amount: "0", asset: market.quoteAsset }),
        }),
      ],
    },
  })
  broker.getOpenOrders = async () => ({ ok: true, data: [] })
  broker.getCanonicalOrderHistory = async () => ({ ok: true, data: [canonicalOrder] })
  broker.getFills = async () => ({ ok: true, data: [recoveredFill] })
  broker.placeOrder = async () => {
    calls.push("placeOrder")
    return { ok: false, errors: [new Error("unexpected order submission in recovery test")] }
  }
  broker.cancelOrder = async () => {
    calls.push("cancelOrder")
    return { ok: false, errors: [new Error("unexpected cancellation in recovery test")] }
  }

  const record = (id, name, data, lineNumber) => ({
    id,
    payload: { id, name, data },
    position: { fileName: "2026-11-05_10-00-00.jsonl", lineNumber },
  })
  const journalRecoveryRecords = [
    record("baseline", "account.snapshot_captured", {
      phase: "PREFLIGHT",
      sourceTime: 1000,
      auditStatus: "COMPLETE",
      balances: [
        { asset: "BTC", free: "1000", locked: "0", total: "1000" },
        { asset: "ETH", free: "1000", locked: "0", total: "1000" },
        { asset: "USDT", free: "1000", locked: "0", total: "1000" },
      ],
      auditReasons: [],
    }, 1),
    record("started", "harvester.started", {
      broker: "binance",
      strategyMode: "conservative",
      enabledMarkets: ["BTCUSDT"],
      tradingEnabled: true,
    }, 2),
    record("intent", "order.submission_requested", {
      clientOrderId: "h-BTCUSDT-buy-1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      price: "65000",
      quantity: "0.01",
      status: "PENDING",
    }, 3),
    record("ack", "order.submitted", {
      clientOrderId: "h-BTCUSDT-buy-1",
      brokerOrderId: "9001",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      price: "65000",
      quantity: "0.01",
      status: "FILLED",
    }, 4),
    record("fill", "execution.fill_applied", {
      fillId: recoveredFill.id,
      tradeId: recoveredFill.tradeId,
      brokerOrderId: recoveredFill.brokerOrderId,
      clientOrderId: recoveredFill.clientOrderId,
      symbol: "BTCUSDT",
      side: "BUY",
      price: "65000",
      quantity: "0.01",
      quoteQuantity: "650",
      liquidityRole: "MAKER",
      commissions: [],
      commissionStatus: "COMPLETE",
    }, 5),
  ]

  const config = structuredClone(tradingConfig)
  config.strategies.CG_coinGrabber.pairs.BTCUSDT.keepQuantity = 0.0099
  config.strategies.CG_coinGrabber.pairs.BTCUSDT.quantityPrecision = 4

  const result = await startHarvesterForTest({
    loadConfig: async () => config,
    env: {
      ...binanceEnv,
      HARVESTER_ENABLE_TRADING: "true",
      HARVESTER_TRADING_MODE: "testnet",
      NODE_ENV: "test",
    },
    brokerAdapterFactory: () => broker,
    journalRecoveryRecords,
    logger: { info() {}, error() {} },
  })

  assert.equal(result.tradingEnabled, true)
  assert.equal(result.userDataReady, true)
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }).baseQuantity.amount, "0.01")
  assert.equal(result.getRecoveryLedger({ marketId: market.id }).buyCost, "650")
  assert.ok(result.recoveredState.requiresExchangeReconciliation)
  assert.deepEqual(calls.filter((call) => ["placeOrder", "cancelOrder"].includes(call)), [])

  await result.stop()
})
