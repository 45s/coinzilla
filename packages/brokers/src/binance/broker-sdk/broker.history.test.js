import test from "node:test"
import assert from "node:assert/strict"

import { BinanceSdkBroker } from "./broker.js"

function createBroker(methods) {
  const broker = Object.create(BinanceSdkBroker.prototype)
  broker.tradingConnection = methods
  broker.logger = { error() {} }
  return broker
}

test("getOrderHistory returns raw Binance orders and supports an order ID filter", async () => {
  const orders = [
    { symbol: "DOGEFDUSD", orderId: 123, status: "FILLED", origQty: "10", executedQty: "10" },
  ]
  let received
  const broker = createBroker({
    async allOrders(params) {
      received = params
      return { data: orders }
    },
  })

  const result = await broker.getOrderHistory({ symbol: "DOGEFDUSD", orderId: 123, limit: 25 })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, orders)
  assert.deepEqual(received, { symbol: "DOGEFDUSD", limit: 25, orderId: 123 })
})

test("getMyTrades returns normalized exact fills including commission details", async () => {
  const trades = [
    { id: 456, symbol: "DOGEFDUSD", orderId: 123, qty: "10", price: "0.05", quoteQty: "0.5", commission: "0.001", commissionAsset: "DOGE", isBuyer: true, isMaker: true, time: 789 },
  ]
  let received
  const broker = createBroker({
    async myTrades(params) {
      received = params
      return { data: trades }
    },
  })

  const result = await broker.getMyTrades({ symbol: "DOGEFDUSD", orderId: 123 })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, [{
    id: "456", orderId: "123", symbol: "DOGEFDUSD", side: "BUY",
    price: "0.05", quantity: "10", quoteQuantity: "0.5",
    commissionAmount: "0.001", commissionAsset: "DOGE", isMaker: true, time: 789,
  }])
  assert.deepEqual(received, { symbol: "DOGEFDUSD", limit: 100, orderId: 123 })
})

test("history methods reject missing symbols and invalid limits", async () => {
  const broker = createBroker({
    async allOrders() { throw new Error("should not be called") },
    async myTrades() { throw new Error("should not be called") },
  })

  for (const result of [
    await broker.getOrderHistory({ limit: 10 }),
    await broker.getOrderHistory({ symbol: "DOGEFDUSD", limit: 0 }),
    await broker.getMyTrades({ symbol: "DOGEFDUSD", limit: 1001 }),
  ]) {
    assert.equal(result.ok, false)
    assert.ok(result.errors?.length)
  }
})
