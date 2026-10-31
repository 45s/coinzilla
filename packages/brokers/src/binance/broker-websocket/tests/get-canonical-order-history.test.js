import assert from "node:assert/strict"
import test from "node:test"
import { CanonicalOrder } from "@coinzilla/entities"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeRpcClient } from "../test-helpers/fake-broker-clients.js"

const symbolInfo = {
  symbol: "DOGEFDUSD",
  baseAsset: "DOGE",
  quoteAsset: "FDUSD",
}

const rawOrder = {
  symbol: "DOGEFDUSD",
  orderId: 123,
  clientOrderId: "client-123",
  side: "BUY",
  type: "LIMIT",
  status: "PARTIALLY_FILLED",
  price: "0.05000000",
  origQty: "100.00000000",
  executedQty: "25.50000000",
  time: 1_700_000_000_000,
  updateTime: 1_700_000_000_100,
}

function createBroker(handlers) {
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {} },
  })
  broker.tradingConnection = createFakeRpcClient(handlers)
  return broker
}

test("getCanonicalOrderHistory returns canonical orders using exact market metadata", async () => {
  const broker = createBroker({
    allOrders(params, options) {
      assert.deepEqual(params, { symbol: "DOGEFDUSD", limit: 50, orderId: 100 })
      assert.deepEqual(options, { signed: true })
      return [rawOrder]
    },
    exchangeInfo(params) {
      assert.deepEqual(params, { symbol: "DOGEFDUSD" })
      return { symbols: [symbolInfo] }
    },
  })

  const result = await broker.getCanonicalOrderHistory({
    symbol: "DOGEFDUSD",
    orderId: 100,
    limit: 50,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.length, 1)
  assert.ok(result.data[0] instanceof CanonicalOrder)
  assert.equal(result.data[0].market.id, "binance:DOGEFDUSD")
  assert.equal(result.data[0].brokerOrderId, "123")
  assert.equal(result.data[0].originalQuantity.amount, "100")
  assert.equal(result.data[0].executedQuantity.amount, "25.5")
  assert.equal(result.data[0].remainingQuantity.amount, "74.5")
  assert.deepEqual(broker.tradingConnection.calls.map(({ method }) => method), [
    "allOrders",
    "exchangeInfo",
  ])
})

test("getCanonicalOrderHistory returns empty history without requiring market metadata", async () => {
  const broker = createBroker({ allOrders: () => [] })

  const result = await broker.getCanonicalOrderHistory({ symbol: "DOGEFDUSD" })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, [])
  assert.deepEqual(broker.tradingConnection.calls.map(({ method }) => method), ["allOrders"])
})

test("getCanonicalOrderHistory fails closed for ambiguous metadata and malformed orders", async () => {
  for (const handlers of [
    {
      allOrders: () => [rawOrder],
      exchangeInfo: () => ({ symbols: [symbolInfo, symbolInfo] }),
    },
    {
      allOrders: () => [{ ...rawOrder, type: "STOP_LOSS_LIMIT" }],
      exchangeInfo: () => ({ symbols: [symbolInfo] }),
    },
    {
      allOrders: () => [{ ...rawOrder, orderId: Number.MAX_SAFE_INTEGER + 1 }],
      exchangeInfo: () => ({ symbols: [symbolInfo] }),
    },
  ]) {
    const broker = createBroker(handlers)
    const result = await broker.getCanonicalOrderHistory({ symbol: "DOGEFDUSD" })
    assert.equal(result.ok, false)
    assert.ok(result.errors.length > 0)
  }
})

test("getCanonicalOrderHistory rejects invalid history filters before RPC", async () => {
  const broker = createBroker({})

  const result = await broker.getCanonicalOrderHistory({
    symbol: "DOGEFDUSD",
    orderId: 10,
    startTime: 100,
  })

  assert.equal(result.ok, false)
  assert.deepEqual(broker.tradingConnection.calls, [])
})
