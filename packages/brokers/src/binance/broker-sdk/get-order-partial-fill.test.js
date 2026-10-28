import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"

describe("BinanceSdkBroker.getOrder partial fills", () => {
  it("returns the unfilled quantity for a partially filled order", async () => {
    const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret", logger: { error() {}, info() {} } })
    broker.tradingConnection = { orderStatus: async (args) => {
      assert.deepEqual(args, { symbol: "ETHUSDT", orderId: 17 })
      return { data: { symbol: "ETHUSDT", orderId: 17, type: "LIMIT", side: "SELL", price: "2500", origQty: "4", executedQty: "1.5" } }
    } }
    const result = await broker.getOrder({ symbol: "ETHUSDT", orderId: 17 })
    assert.equal(result.ok, true)
    assert.equal(result.data.quantity, 2.5)
    assert.equal(result.data.id, "17")
    assert.equal(result.data.side, "SELL")
  })
})
