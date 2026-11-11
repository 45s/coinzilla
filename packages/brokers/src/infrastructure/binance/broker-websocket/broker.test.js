import assert from "node:assert/strict"
import test from "node:test"

import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient, createFakeStreamsClient } from "./test-helpers/fake-broker-clients.js"

const loggerCalls = []
const logger = { debug() {}, error() {}, info() {}, system(message) { loggerCalls.push(message) }, warn() {} }
const config = { apiKey: "test-key", apiSecret: "test-secret", tradingMode: "testnet", logger }

function createBroker(handlers = {}) {
  const rpc = createFakeRpcClient(handlers)
  const streams = createFakeStreamsClient()
  const broker = new BinanceSdkBroker(config, {
    apiClientFactory: () => rpc,
    marketClientFactory: () => streams,
  })
  return { broker, rpc, streams }
}

const exchangeOrder = {
  symbol: "BTCUSDT",
  orderId: 42,
  clientOrderId: "client-42",
  type: "LIMIT",
  side: "BUY",
  price: "65000.10",
  origQty: "0.25000000",
  executedQty: "0.05000000",
  status: "PARTIALLY_FILLED",
}

test("getAssets uses signed account.status and adapts non-zero balances", async () => {
  const { broker, rpc } = createBroker({
    "account.status": (params, options) => {
      assert.deepEqual(params, { omitZeroBalances: true })
      assert.deepEqual(options, { signed: true })
      return { balances: [
        { asset: "BTC", free: "0.25", locked: "0.05" },
        { asset: "USDT", free: "0", locked: "0" },
      ] }
    },
  })

  assert.deepEqual(await broker.getAssets(), {
    ok: true,
    data: [{ ticker: "BTC", quantity: 0.3 }],
  })
  assert.equal(rpc.calls[0].method, "account.status")
})

test("getOpenOrders uses signed openOrders.status with an optional symbol", async () => {
  const { broker, rpc } = createBroker({
    "openOrders.status": () => [exchangeOrder],
  })

  const allOrders = await broker.getOpenOrders()
  const symbolOrders = await broker.getOpenOrders({ symbol: "BTCUSDT" })

  assert.deepEqual(rpc.calls.map(({ method, params, options }) => ({ method, params, options })), [
    { method: "openOrders.status", params: {}, options: { signed: true } },
    { method: "openOrders.status", params: { symbol: "BTCUSDT" }, options: { signed: true } },
  ])
  assert.equal(allOrders.ok, true)
  assert.equal(allOrders.data[0].id, "42")
  assert.equal(allOrders.data[0].quantity, 0.2)
  assert.equal(allOrders.data[0].originalQuantity, "0.25000000")
  assert.equal(allOrders.data[0].executedQuantity, "0.05000000")
  assert.equal(allOrders.data[0].status, "PARTIALLY_FILLED")
  assert.equal(symbolOrders.ok, true)
})

test("getOrder and cancelOrder use the correct signed RPC methods", async () => {
  const { broker, rpc } = createBroker({
    "order.status": () => exchangeOrder,
    "order.cancel": () => ({ ...exchangeOrder, status: "CANCELED" }),
  })

  const current = await broker.getOrder({ symbol: "BTCUSDT", orderId: 42 })
  const canceled = await broker.cancelOrder({ symbol: "BTCUSDT", orderId: 42 })

  assert.deepEqual(rpc.calls.map(({ method, params, options }) => ({ method, params, options })), [
    { method: "order.status", params: { symbol: "BTCUSDT", orderId: 42 }, options: { signed: true } },
    { method: "order.cancel", params: { symbol: "BTCUSDT", orderId: 42 }, options: { signed: true, stateChanging: true } },
  ])
  assert.equal(current.ok, true)
  assert.equal(current.data.id, "42")
  assert.equal(current.data.quantity, 0.2)
  assert.equal(canceled.ok, true)
  assert.equal(canceled.data.status, "CANCELED")
})

test("cancelAllOpenOrders marks the signed mutation as state-changing", async () => {
  const { broker, rpc } = createBroker({
    "openOrders.cancelAll": () => [exchangeOrder, { ...exchangeOrder, orderId: 43 }],
  })

  const result = await broker.cancelAllOpenOrders({ symbol: "BTCUSDT" })

  assert.deepEqual(rpc.calls[0], {
    method: "openOrders.cancelAll",
    params: { symbol: "BTCUSDT" },
    options: { signed: true, stateChanging: true },
  })
  assert.deepEqual(result.data.map((order) => order.id), ["42", "43"])
})

test("getPrices uses the public ticker.price method", async () => {
  const ticker = { symbol: "BTCUSDT", price: "65000.10" }
  const { broker, rpc } = createBroker({ "ticker.price": () => ticker })

  assert.deepEqual(await broker.getPrices({ symbol: "BTCUSDT" }), { ok: true, data: ticker })
  assert.deepEqual(rpc.calls[0], {
    method: "ticker.price",
    params: { symbol: "BTCUSDT" },
    options: {},
  })
})

test("getCandles uses public klines and returns normalized, ordered exact-string candles", async () => {
  const now = Date.now()
  const rows = [
    [now - 120_000, "1.0000", "1.5000", "0.9000", "1.2000", "10.0000", now - 60_001, "12", 10, "5", "6", "0"],
    [now - 60_000, "1.2000", "1.6000", "1.1000", "1.5000", "11.0000", now - 1, "15", 11, "5", "7", "0"],
  ]
  const { broker, rpc } = createBroker({ klines: (params) => {
    assert.deepEqual(params, { symbol: "BTCUSDT", interval: "1m", limit: 100 })
    return rows
  } })

  const result = await broker.getCandles({ symbol: "btcusdt", interval: "1m", limit: 100 })

  assert.equal(result.ok, true)
  assert.deepEqual(rpc.calls[0], {
    method: "klines",
    params: { symbol: "BTCUSDT", interval: "1m", limit: 100 },
    options: {},
  })
  assert.deepEqual(result.data.map(({ symbol, interval, openTime, closeTime, open, high, low, close, volume, isClosed }) => ({
    symbol, interval, openTime, closeTime, open, high, low, close, volume, isClosed,
  })), [
    {
      symbol: "BTCUSDT", interval: "1m",
      openTime: now - 120_000, closeTime: now - 60_001,
      open: "1.0000", high: "1.5000", low: "0.9000", close: "1.2000", volume: "10.0000", isClosed: true,
    },
    {
      symbol: "BTCUSDT", interval: "1m",
      openTime: now - 60_000, closeTime: now - 1,
      open: "1.2000", high: "1.6000", low: "1.1000", close: "1.5000", volume: "11.0000", isClosed: true,
    },
  ])
  assert.equal(Object.isFrozen(result.data), true)
})

test("getCandles passes optional time bounds and accepts an empty history", async () => {
  const { broker, rpc } = createBroker({ klines: () => [] })
  const result = await broker.getCandles({
    symbol: "BTCUSDT",
    interval: "1m",
    startTime: 100,
    endTime: 200,
  })

  assert.deepEqual(result, { ok: true, data: [] })
  assert.deepEqual(rpc.calls[0], {
    method: "klines",
    params: { symbol: "BTCUSDT", interval: "1m", limit: 500, startTime: 100, endTime: 200 },
    options: {},
  })
})

test("getCandles rejects invalid query arguments before making an RPC request", async () => {
  const invalidInputs = [
    { symbol: "", interval: "1m" },
    { symbol: "BTCUSDT", interval: "2m" },
    { symbol: "BTCUSDT", interval: "1m", limit: 0 },
    { symbol: "BTCUSDT", interval: "1m", limit: 1001 },
    { symbol: "BTCUSDT", interval: "1m", startTime: -1 },
    { symbol: "BTCUSDT", interval: "1m", startTime: 200, endTime: 100 },
  ]

  for (const input of invalidInputs) {
    const { broker, rpc } = createBroker()
    const result = await broker.getCandles(input)
    assert.equal(result.ok, false, JSON.stringify(input))
    assert.equal(rpc.calls.length, 0, JSON.stringify(input))
  }
})

test("getCandles rejects malformed and non-ascending Binance responses", async () => {
  const malformed = createBroker({ klines: () => ({ rows: [] }) })
  assert.equal((await malformed.broker.getCandles({ symbol: "BTCUSDT", interval: "1m" })).ok, false)

  const now = Date.now()
  const first = [now - 120_000, "1", "2", "0.5", "1.5", "10", now - 60_001, "15", 10, "5", "7", "0"]
  const second = [now - 60_000, "1.5", "2", "1", "1.7", "10", now - 1, "17", 10, "5", "7", "0"]
  const unsorted = createBroker({ klines: () => [second, first] })
  assert.equal((await unsorted.broker.getCandles({ symbol: "BTCUSDT", interval: "1m" })).ok, false)
})

test("subscribeForCandles subscribes to the normalized Kline stream and forwards candles", async () => {
  const { broker, streams } = createBroker()
  broker.connected = true
  const candles = []
  const result = await broker.subscribeForCandles({
    symbol: "btcusdt",
    interval: "1m",
    onCandle: (candle) => candles.push(candle),
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.stream, "btcusdt@kline_1m")
  assert.deepEqual(streams.calls, [{ method: "subscribe", stream: "btcusdt@kline_1m" }])

  streams.emit("btcusdt@kline_1m", {
    e: "kline",
    s: "BTCUSDT",
    k: {
      t: 1_700_000_000_000,
      T: 1_700_000_059_999,
      s: "BTCUSDT",
      i: "1m",
      o: "1.0000",
      h: "2.0000",
      l: "0.5000",
      c: "1.5000",
      v: "10.0000",
      x: false,
    },
  })
  assert.equal(candles.length, 1)
  assert.equal(candles[0].isClosed, false)
  assert.equal(candles[0].symbol, "BTCUSDT")
  assert.equal(Object.isFrozen(candles[0]), true)

  await result.data.unsubscribe()
  assert.deepEqual(streams.calls[1], { method: "unsubscribe", stream: "btcusdt@kline_1m" })
})

test("subscribeForCandles rejects invalid subscriptions and mismatched stream events", async () => {
  const { broker, streams } = createBroker()
  assert.equal((await broker.subscribeForCandles({
    symbol: "BTCUSDT", interval: "1m", onCandle: () => {},
  })).ok, false)

  broker.connected = true
  assert.equal((await broker.subscribeForCandles({
    symbol: "BTCUSDT", interval: "2m", onCandle: () => {},
  })).ok, false)
  assert.equal((await broker.subscribeForCandles({
    symbol: "BTCUSDT", interval: "1m", onCandle: null,
  })).ok, false)

  const result = await broker.subscribeForCandles({
    symbol: "BTCUSDT",
    interval: "1m",
    onCandle: () => {},
  })
  assert.equal(result.ok, true)
  assert.throws(() => streams.emit("btcusdt@kline_1m", {
    e: "kline",
    s: "ETHUSDT",
    k: {
      t: 1_700_000_000_000,
      T: 1_700_000_059_999,
      s: "ETHUSDT",
      i: "1m",
      o: "1.0000",
      h: "2.0000",
      l: "0.5000",
      c: "1.5000",
      v: "10.0000",
      x: false,
    },
  }), /does not match the candle subscription/)
})

test("connect opens the WebSocket API client and disconnect closes both native clients", async () => {
  const { broker, rpc, streams } = createBroker()
  await broker.connect()
  assert.equal(broker.connected, true)
  assert.equal(rpc.state, "open")
  assert.ok(loggerCalls.includes("Binance WebSocket API connected; public Streams connect on demand"))

  await broker.disconnect()
  assert.equal(broker.connected, false)
  assert.equal(rpc.state, "closed")
  assert.ok(loggerCalls.includes("Binance native WebSocket clients disconnected"))
  assert.deepEqual(streams.calls, [])
})

test("connect failure cleans the API client and leaves the broker disconnected", async () => {
  const rpc = createFakeRpcClient()
  let cleanupCalls = 0
  rpc.connect = async () => { throw new Error("API socket failed") }
  rpc.disconnect = () => {
    cleanupCalls += 1
    throw new Error("cleanup failed")
  }
  const streams = createFakeStreamsClient()
  const broker = new BinanceSdkBroker(config, {
    apiClientFactory: () => rpc,
    marketClientFactory: () => streams,
  })

  await assert.rejects(() => broker.connect(), /API socket failed/)
  assert.equal(broker.connected, false)
  assert.equal(cleanupCalls, 1)
  assert.equal(streams.listenerCount, 0)
})
