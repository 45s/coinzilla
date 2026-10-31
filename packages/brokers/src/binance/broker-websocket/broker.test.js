import assert from "node:assert/strict"
import test from "node:test"

import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient, createFakeStreamsClient } from "./tests/unit/test-helpers/fake-broker-clients.js"

const logger = { debug() {}, error() {}, info() {}, warn() {} }
const config = { apiKey: "test-key", apiSecret: "test-secret", logger }

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

test("connect opens the WebSocket API client and disconnect closes both native clients", async () => {
  const { broker, rpc, streams } = createBroker()
  await broker.connect()
  assert.equal(broker.connected, true)
  assert.equal(rpc.state, "open")

  await broker.disconnect()
  assert.equal(broker.connected, false)
  assert.equal(rpc.state, "closed")
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
