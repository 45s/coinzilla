import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { startHarvester } from "./start-harvester.js"

const tradingConfig = {
  settings: { minProfit: 0.01 },
  pairs: {
    BTCUSDT: { enabled: true, orderQuantity: 0.01, makerPercent: 0 },
    ETHUSDT: { enabled: false, orderQuantity: 0.1, makerPercent: 0 },
  },
}
const createBroker = (calls = [], { subscribeResult, subscribeResultBySymbol = {} } = {}) => {
  const subscriptions = new Map()
  return {
    connect: async () => calls.push("connect"),
    disconnect: async () => calls.push("disconnect"),
    placeOrder: async () => ({ ok: true }),
    cancelOrder: async () => ({ ok: true }),
    getOpenOrders: async () => ({ ok: true }),
    getFills: async () => ({ ok: true }),
    getAccountSnapshot: async () => ({ ok: true }),
    getSymbolFilters: async () => ({ ok: true }),
    getPrices: async () => ({ ok: true }),
    subscribeForPrices: async ({ symbol, onPrice }) => {
      calls.push("subscribe:" + symbol)
      subscriptions.set(symbol, onPrice)
      return subscribeResultBySymbol[symbol] ?? subscribeResult ?? {
        ok: true,
        data: { unsubscribe: async () => calls.push("unsubscribe:" + symbol) },
      }
    },
    subscribeForUserData: async () => ({ ok: true }),
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
    strategy: {
      evaluate: (input) => {
        strategyCalls.push(input)
        return { action: "NO_ACTION" }
      },
    },
    logger: { info() {}, error() {} },
  })
  assert.equal(result.connected, true)
  assert.deepEqual(result.subscriptions, ["BTCUSDT"])
  assert.deepEqual(calls, ["connect", "subscribe:BTCUSDT"])

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
  assert.deepEqual(calls, ["connect", "subscribe:BTCUSDT", "unsubscribe:BTCUSDT", "disconnect"])
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
  assert.deepEqual(calls, ["connect", "subscribe:BTCUSDT", "disconnect"])
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
    "subscribe:BTCUSDT",
    "subscribe:ETHUSDT",
    "unsubscribe:BTCUSDT",
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
