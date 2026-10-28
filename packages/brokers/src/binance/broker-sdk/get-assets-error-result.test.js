import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"

describe("BinanceSdkBroker.getAssets errors", () => {
  it("returns a structured error when account status fails", async () => {
    const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret", logger: { error() {}, info() {} } })
    broker.tradingConnection = { accountStatus: async () => { throw new Error("account endpoint unavailable") } }
    const result = await broker.getAssets()
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "account endpoint unavailable")
  })
})
