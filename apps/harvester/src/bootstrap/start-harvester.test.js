import test from "node:test"
import assert from "node:assert/strict"
import { startHarvester } from "./start-harvester.js"

const tradingConfig = {
  settings: { minProfit: 0.01 },
  pairs: {
    BTCUSDT: { enabled: true, orderQuantity: 0.01 },
    ETHUSDT: { enabled: false, orderQuantity: 0.1 },
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
      calls.push(`subscribe:${symbol}`)
      subscriptions.set(symbol, onPrice)
      return subscribeResultBySymbol[symbol] ?? subscribeResult ?? {
        ok: true,
        data: { unsubscribe: async () => calls.push(`unsubscribe:${symbol}`) },
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

test("does not connect a broker unless explicitly selected", async () => {
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: {},
  })

  assert.equal(result.tradingConfig, tradingConfig)
  assert.equal(result.broker, undefined)
  assert.equal(result.connected, false)
  await result.stop()
})

test("subscribes only enabled pairs and passes broker prices to the strategy", async () => {
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
        return { action: "WAIT" }
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
  assert.deepEqual(strategyCalls[0], {
    marketPrice: {
      symbol: "BTCUSDT",
      price: "65000.12000000",
      timestamp: 123,
    },
    pairConfig: tradingConfig.pairs.BTCUSDT,
    settings: tradingConfig.settings,
  })

  await result.stop()
  await result.stop()
  assert.deepEqual(calls, [
    "connect",
    "subscribe:BTCUSDT",
    "unsubscribe:BTCUSDT",
    "disconnect",
  ])
})

test("uses the safe waiting strategy by default", async () => {
  const broker = createBroker()
  const result = await startHarvester({
    loadConfig: async () => tradingConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: { info() {}, error() {} },
  })

  const decision = await result.processMarketPrice({
    symbol: "BTCUSDT",
    priceEvent: {
      symbol: "BTCUSDT",
      price: "65000.12",
      timestamp: 123,
    },
    pairConfig: tradingConfig.pairs.BTCUSDT,
    settings: tradingConfig.settings,
  })

  assert.equal(decision.ok, true)
  assert.equal(decision.data.decision.action, "WAIT")
  await result.stop()
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
      ETHUSDT: { enabled: true, orderQuantity: 0.1 },
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
    startHarvester({
      loadConfig: async () => tradingConfig,
      env: { HARVESTER_BROKER: "unknown" },
    }),
    /Unsupported HARVESTER_BROKER/,
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
