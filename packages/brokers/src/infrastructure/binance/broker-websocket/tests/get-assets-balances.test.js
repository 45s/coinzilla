import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeRpcClient } from "../test-helpers/fake-broker-clients.js"

const createBroker = (handlers) => {
  const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret", logger: { error() {}, info() {} } })
  broker.tradingConnection = createFakeRpcClient(handlers)
  return broker
}

describe("BinanceSdkBroker.getAssets", () => {
  it("combines free and locked balances and omits zero balances", async () => {
    const instance = createBroker({
      "account.status": (params) => {
        assert.deepEqual(params, { omitZeroBalances: true })
        return { balances: [
          { asset: "BTC", free: "0.2", locked: "0.05" },
          { asset: "USDT", free: "0", locked: "0" },
        ] }
      },
    })
    const result = await instance.getAssets()
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, [{ ticker: "BTC", quantity: 0.25 }])
  })
})

it("returns a structured error when account.status fails", async () => {
  const instance = createBroker({ "account.status": async () => { throw new Error("account endpoint unavailable") } })
  const result = await instance.getAssets()
  assert.equal(result.ok, false)
  assert.equal(result.errors[0].message, "account endpoint unavailable")
})
