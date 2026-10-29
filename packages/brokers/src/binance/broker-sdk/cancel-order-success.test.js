import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"

describe("BinanceSdkBroker.cancelOrder success", () => {
  it("passes identifiers and adapts the canceled order", async () => {
    const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret", logger: { error() {}, info() {} } })
    let args
    broker.tradingConnection = { orderCancel: async (input) => {
      args = input
      return { data: { symbol: "BTCUSDT", orderId: 23, type: "LIMIT", side: "BUY", price: "100", origQty: "2", executedQty: "0" } }
    } }
    const result = await broker.cancelOrder({ symbol: "BTCUSDT", orderId: 23 })
    assert.deepEqual(args, { symbol: "BTCUSDT", orderId: 23 })
    assert.equal(result.ok, true)
    assert.equal(result.data.id, "23")
    assert.equal(result.data.quantity, 2)
  })
})
