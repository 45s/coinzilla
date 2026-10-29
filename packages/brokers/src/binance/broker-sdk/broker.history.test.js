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

test("getMyTrades returns raw executions including commission details", async () => {
  const trades = [
    { symbol: "DOGEFDUSD", orderId: 123, qty: "10", price: "0.05", commission: "0.001", commissionAsset: "DOGE" },
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
  assert.deepEqual(result.data, trades)
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
