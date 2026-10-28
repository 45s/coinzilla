import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"

describe("BinanceSdkBroker.createOrder overrides", () => {
  it("preserves explicitly supplied order options", async () => {
    const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret", logger: { error() {}, info() {} } })
    let args
    broker.tradingConnection = { orderPlace: async (input) => {
      args = input
      return { data: { symbol: "BTCUSDT", orderId: 10, type: "MARKET", side: "SELL", price: "100", origQty: "1", executedQty: "0" } }
    } }
    const input = { symbol: "BTCUSDT", quantity: 1, price: 100, side: "SELL", type: "MARKET", timeInForce: "IOC" }
    const result = await broker.createOrder(input)
    assert.deepEqual(args, input)
    assert.equal(result.ok, true)
    assert.equal(result.data.type, "MARKET")
    assert.equal(result.data.side, "SELL")
  })
})
