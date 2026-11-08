import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeRpcClient } from "../test-helpers/fake-broker-clients.js"

describe("BinanceSdkBroker.getPrices", () => {
  it("passes the symbol and preserves the ticker.price response", async () => {
    const payload = { symbol: "BTCUSDT", price: "65000.12000000" }
    const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret" })
    const rpc = createFakeRpcClient({ "ticker.price": (params) => {
      assert.deepEqual(params, { symbol: "BTCUSDT" })
      return payload
    } })
    broker.tradingConnection = rpc
    const result = await broker.getPrices({ symbol: "BTCUSDT" })
    assert.equal(rpc.calls[0].method, "ticker.price")
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, payload)
  })
})
