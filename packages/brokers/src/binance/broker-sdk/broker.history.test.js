import test from "node:test"
import assert from "node:assert/strict"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

function createBroker(handlers) {
  const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret" })
  const rpc = createFakeRpcClient(handlers)
  broker.tradingConnection = rpc
  return { broker, rpc }
}

test("getOrderHistory uses signed allOrders and supports an order ID filter", async () => {
  const orders = [{ symbol: "DOGEFDUSD", orderId: 123, status: "FILLED", origQty: "10", executedQty: "10" }]
  const { broker, rpc } = createBroker({ allOrders: () => orders })
  const result = await broker.getOrderHistory({ symbol: "DOGEFDUSD", orderId: 123, limit: 25 })
  assert.equal(result.ok, true)
  assert.deepEqual(result.data, orders)
  assert.deepEqual(rpc.calls[0], {
    method: "allOrders",
    params: { symbol: "DOGEFDUSD", limit: 25, orderId: 123 },
    options: { signed: true },
  })
})

test("getMyTrades uses signed myTrades and preserves exact fill strings", async () => {
  const trades = [{
    id: 456, symbol: "DOGEFDUSD", orderId: 123, qty: "10", price: "0.05",
    quoteQty: "0.5", commission: "0.001", commissionAsset: "DOGE",
    isBuyer: true, isMaker: true, time: 789,
  }]
  const { broker, rpc } = createBroker({ myTrades: () => trades })
  const result = await broker.getMyTrades({ symbol: "DOGEFDUSD", orderId: 123 })
  assert.deepEqual(result.data, [{
    id: "456", orderId: "123", symbol: "DOGEFDUSD", side: "BUY",
    price: "0.05", quantity: "10", quoteQuantity: "0.5",
    commissionAmount: "0.001", commissionAsset: "DOGE", isMaker: true, time: 789,
  }])
  assert.deepEqual(rpc.calls[0], {
    method: "myTrades",
    params: { symbol: "DOGEFDUSD", limit: 1000, orderId: 123 },
    options: { signed: true },
  })
})

test("history methods reject missing symbols and invalid limits before sending", async () => {
  const { broker, rpc } = createBroker({ allOrders: () => [], myTrades: () => [] })
  for (const result of [
    await broker.getOrderHistory({ limit: 10 }),
    await broker.getOrderHistory({ symbol: "DOGEFDUSD", limit: 0 }),
    await broker.getMyTrades({ symbol: "DOGEFDUSD", limit: 1001 }),
  ]) {
    assert.equal(result.ok, false)
    assert.ok(result.errors?.length)
  }
  assert.equal(rpc.calls.length, 0)
})
