import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeRpcClient } from "../test-helpers/fake-broker-clients.js"

describe("BinanceSdkBroker.getPrices errors", () => {
  it("returns a structured error when ticker.price fails", async () => {
    const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret", logger: { error() {}, info() {} } })
    broker.tradingConnection = createFakeRpcClient({
      "ticker.price": async () => { throw new Error("ticker endpoint unavailable") },
    })
    const result = await broker.getPrices({ symbol: "BTCUSDT" })
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "ticker endpoint unavailable")
  })
})
