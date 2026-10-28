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

it("returns an empty successful list when no open orders exist", async () => {
  const broker = createBroker()
  let params
  broker.tradingConnection = {
    openOrdersStatus: async (input) => { params = input; return { data: [] } },
  }
  const result = await broker.getOpenOrders()
  assert.equal(result.ok, true)
  assert.deepEqual(result.data, [])
  assert.deepEqual(params, {})
})
