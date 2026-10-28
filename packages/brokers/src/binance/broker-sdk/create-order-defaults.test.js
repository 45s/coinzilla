import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"

describe("BinanceSdkBroker.createOrder defaults", () => {
  it("supplies default side, type, and time-in-force", async () => {
    const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret", logger: { error() {}, info() {} } })
    let args
    broker.tradingConnection = { orderPlace: async (input) => {
      args = input
      return { data: { symbol: "BTCUSDT", orderId: 9, type: "LIMIT", side: "BUY", price: "100", origQty: "2", executedQty: "0" } }
    } }
    const result = await broker.createOrder({ symbol: "BTCUSDT", quantity: 2, price: 100 })
    assert.deepEqual(args, { symbol: "BTCUSDT", quantity: 2, price: 100, side: "BUY", type: "LIMIT", timeInForce: "GTC" })
    assert.equal(result.ok, true)
    assert.equal(result.data.id, "9")
    assert.equal(result.data.quantity, 2)
  })
})
