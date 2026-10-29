import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"

describe("BinanceSdkBroker.getPrices", () => {
  it("passes the symbol and preserves the ticker response", async () => {
    const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret", logger: { error() {}, info() {} } })
    const payload = { symbol: "BTCUSDT", price: "65000.12000000" }
    let args
    broker.tradingConnection = { tickerPrice: async (input) => { args = input; return { data: payload } } }
    const result = await broker.getPrices({ symbol: "BTCUSDT" })
    assert.deepEqual(args, { symbol: "BTCUSDT" })
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, payload)
  })
})
