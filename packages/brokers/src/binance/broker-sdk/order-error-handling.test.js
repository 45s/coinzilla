import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"

function createBroker() {
  return new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {}, debug() {}, warn() {} },
  })
}

describe("BinanceSdkBroker order error results", () => {
  it("returns errors from getOrder when the SDK rejects", async () => {
    const broker = createBroker()
    broker.tradingConnection = {
      orderStatus: async () => { throw new Error("request timed out") },
    }

    const result = await broker.getOrder({ symbol: "BTCUSDT", orderId: 123 })
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "request timed out")
  })

  it("returns errors from createOrder when the SDK rejects", async () => {
    const broker = createBroker()
    broker.tradingConnection = {
      orderPlace: async () => { throw new Error("insufficient balance") },
    }

    const result = await broker.createOrder({
      symbol: "BTCUSDT",
      quantity: 1,
      price: 100,
    })
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "insufficient balance")
  })

  it("returns errors from cancelOrder when the SDK rejects", async () => {
    const broker = createBroker()
    broker.tradingConnection = {
      orderCancel: async () => { throw new Error("unknown order") },
    }

    const result = await broker.cancelOrder({ symbol: "BTCUSDT", orderId: 123 })
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "unknown order")
  })
})

it("returns errors from cancelAllOpenOrders when the SDK rejects", async () => {
  const broker = createBroker()
  broker.tradingConnection = {
    openOrdersCancelAll: async () => { throw new Error("bulk cancel unavailable") },
  }
  const result = await broker.cancelAllOpenOrders({ symbol: "BTCUSDT" })
  assert.equal(result.ok, false)
  assert.equal(result.errors[0].message, "bulk cancel unavailable")
})
