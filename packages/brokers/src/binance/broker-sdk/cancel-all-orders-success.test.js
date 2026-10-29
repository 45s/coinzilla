import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"

describe("BinanceSdkBroker.cancelAllOpenOrders success", () => {
  it("passes the symbol and adapts each canceled order", async () => {
    const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret", logger: { error() {}, info() {} } })
    let args
    broker.tradingConnection = { openOrdersCancelAll: async (input) => {
      args = input
      return { data: [
        { symbol: "BTCUSDT", orderId: 1, type: "LIMIT", side: "BUY", price: "100", origQty: "2", executedQty: "0" },
        { symbol: "BTCUSDT", orderId: 2, type: "LIMIT", side: "SELL", price: "101", origQty: "3", executedQty: "1" },
      ] }
    } }
    const result = await broker.cancelAllOpenOrders({ symbol: "BTCUSDT" })
    assert.deepEqual(args, { symbol: "BTCUSDT" })
    assert.equal(result.ok, true)
    assert.deepEqual(result.data.map((order) => order.id), ["1", "2"])
    assert.deepEqual(result.data.map((order) => order.quantity), [2, 2])
  })
})
