import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"

const broker = () => new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret", logger: { error() {}, info() {} } })

describe("BinanceSdkBroker.getAssets", () => {
  it("combines free and locked balances and omits zero balances", async () => {
    const instance = broker()
    instance.tradingConnection = { accountStatus: async (params) => {
      assert.deepEqual(params, { omitZeroBalances: true })
      return { data: { balances: [
        { asset: "BTC", free: "0.2", locked: "0.05" },
        { asset: "USDT", free: "0", locked: "0" },
      ] } }
    } }
    const result = await instance.getAssets()
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, [{ ticker: "BTC", quantity: 0.25 }])
  })
})

it("returns a structured error when the SDK rejects asset retrieval", async () => {
  const instance = broker()
  instance.tradingConnection = {
    accountStatus: async () => { throw new Error("account endpoint unavailable") },
  }
  const result = await instance.getAssets()
  assert.equal(result.ok, false)
  assert.equal(result.errors[0].message, "account endpoint unavailable")
})
