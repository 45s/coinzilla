import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

function createBroker(handlers) {
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {}, debug() {}, warn() {} },
  })
  broker.tradingConnection = createFakeRpcClient(handlers)
  return broker
}

describe("BinanceSdkBroker order error results", () => {
  it("returns errors from getOrder when order.status rejects", async () => {
    const broker = createBroker({ "order.status": async () => { throw new Error("request timed out") } })
    const result = await broker.getOrder({ symbol: "BTCUSDT", orderId: 123 })
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "request timed out")
  })

  it("returns errors from createOrder when order.place rejects", async () => {
    const broker = createBroker({ "order.place": async () => { throw new Error("insufficient balance") } })
    const result = await broker.createOrder({ symbol: "BTCUSDT", quantity: 1, price: 100 })
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "insufficient balance")
  })

  it("returns errors from cancelOrder when order.cancel rejects", async () => {
    const broker = createBroker({ "order.cancel": async () => { throw new Error("unknown order") } })
    const result = await broker.cancelOrder({ symbol: "BTCUSDT", orderId: 123 })
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "unknown order")
  })

  it("returns errors from cancelAllOpenOrders when openOrders.cancelAll rejects", async () => {
    const broker = createBroker({ "openOrders.cancelAll": async () => { throw new Error("bulk cancel unavailable") } })
    const result = await broker.cancelAllOpenOrders({ symbol: "BTCUSDT" })
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "bulk cancel unavailable")
  })
})

it("returns an empty successful list when no open orders exist", async () => {
  const broker = createBroker({ "openOrders.status": () => [] })
  const result = await broker.getOpenOrders()
  assert.equal(result.ok, true)
  assert.deepEqual(result.data, [])
})
