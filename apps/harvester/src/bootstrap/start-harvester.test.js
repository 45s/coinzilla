import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Balance, Fill, Market, Money, Quantity, TradingRules } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { startHarvester } from "./start-harvester.js"

const tradingConfig = {
  settings: { minProfit: 0.01 },
  pairs: {
    BTCUSDT: { enabled: true, orderQuantity: 0.01, makerPercent: 0 },
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
  let userDataHandlers
  let accountSnapshotTime = 0
  return {
    connect: async () => calls.push("connect"),
    disconnect: async () => calls.push("disconnect"),
    placeOrder: async () => ({ ok: true }),
    cancelOrder: async () => ({ ok: true }),
    getOpenOrders: async () => ({ ok: true }),
    getFills: async () => ({ ok: true }),
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
    getPrices: async () => ({ ok: true }),
    subscribeForPrices: async ({ symbol, onPrice }) => {
      calls.push("subscribe:" + symbol)
      subscriptions.set(symbol, onPrice)
      return subscribeResultBySymbol[symbol] ?? subscribeResult ?? {
        ok: true,
        data: { unsubscribe: async () => calls.push("unsubscribe:" + symbol) },
      }
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
  assert.equal(result.userDataReady, true)

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

test("uses Aggressive by default and passes updated Portfolio after a fill", async () => {
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
  assert.equal(decision.data.decision.strategy, "AGGRESSIVE")
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
      ETHUSDT: { enabled: true, orderQuantity: 0.1, makerPercent: 0 },
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

test("accounts canonical execution events before allowing further order placement", async () => {
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
  assert.equal(result.userDataReady, true)
  assert.equal(result.userDataStatus, "READY")
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }).baseQuantity.amount, "0.01")
  assert.equal(result.getAccountSnapshot().sourceTime, 2)
  assert.equal(
    result.getRecoveryLedger({ marketId: handled.fill.market.id }).buyCost,
    "650",
  )

  const order = await result.placeOrder({
    order: { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "0.01", price: "60000" },
  })
  assert.equal(order.ok, true)
  await result.stop()
})

test("requires explicit reconciliation acknowledgement after a user-data stream recovery", async () => {
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
  assert.equal(result.userDataReady, true)
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

test("allows order placement again after canonical execution accounting completes", async () => {
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

  assert.equal(result.userDataReady, true)
  assert.equal(result.userDataStatus, "READY")
  const order = await result.placeOrder({
    order: { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "0.01", price: "60000" },
  })
  assert.equal(order.ok, true)
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

test("exposed broker port cannot bypass the user-data readiness gate", async () => {
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
  const order = await result.broker.placeOrder({
    order: { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "0.01", price: "60000" },
  })

  assert.equal(order.ok, false)
  assert.match(order.errors[0].message, /user-data accounting is not ready/)
  await result.stop()
})

test("blocks order placement when a trade event cannot be accounted", async () => {
  const broker = createBroker()
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: { info() {}, error() {} },
  })

  broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    fill: { malformed: true },
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "EXECUTION_ACCOUNTING_FAILED")
  assert.equal(result.portfolio.positions.length, 0)
  const order = await result.broker.placeOrder({
    order: { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "0.01", price: "60000" },
  })
  assert.equal(order.ok, false)
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

test("blocks order placement when account balances cannot be refreshed after a fill", async () => {
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
  assert.equal(result.userDataStatus, "ACCOUNT_SNAPSHOT_REFRESH_FAILED")
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }).baseQuantity.amount, "0.01")
  assert.equal(result.getAccountSnapshot().sourceTime, 1)
  const order = await result.placeOrder({
    order: { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "0.01", price: "60000" },
  })
  assert.equal(order.ok, false)
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
