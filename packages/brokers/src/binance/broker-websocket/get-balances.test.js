import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Balance } from "@coinzilla/entities"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

const createBroker = (handlers) => {
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {} },
  })
  broker.tradingConnection = createFakeRpcClient(handlers)
  return broker
}

describe("BinanceSdkBroker.getBalances", () => {
  it("returns exact canonical balances including zero balances", async () => {
    const instance = createBroker({
      "account.status": (params) => {
        assert.deepEqual(params, { omitZeroBalances: false })
        return {
          balances: [
            { asset: "BTC", free: "0.200000000000000001", locked: "0.050000000000000009" },
            { asset: "USDT", free: "0", locked: "0" },
          ],
        }
      },
    })

    const result = await instance.getBalances()

    assert.equal(result.ok, true)
    assert.equal(result.data.length, 2)
    assert.ok(result.data.every((balance) => balance instanceof Balance))
    assert.deepEqual(
      result.data.map(({ asset, free, locked, total }) => ({
        asset: asset.value,
        free: free.amount,
        locked: locked.amount,
        total: total.amount,
      })),
      [
        {
          asset: { id: "btc", code: "BTC" },
          free: "0.200000000000000001",
          locked: "0.050000000000000009",
          total: "0.25000000000000001",
        },
        {
          asset: { id: "usdt", code: "USDT" },
          free: "0",
          locked: "0",
          total: "0",
        },
      ],
    )
  })

  it("returns a structured error when account.status fails", async () => {
    const instance = createBroker({
      "account.status": async () => {
        throw new Error("account endpoint unavailable")
      },
    })

    const result = await instance.getBalances()

    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "account endpoint unavailable")
  })

  it("returns a structured error for incomplete or malformed account snapshots", async () => {
    for (const balances of [undefined, null, {}, [{ asset: "BTC", free: "1" }]]) {
      const instance = createBroker({
        "account.status": () => ({ balances }),
      })

      const result = await instance.getBalances()

      assert.equal(result.ok, false)
      assert.ok(result.errors.length > 0)
    }
  })

  it("rejects duplicate asset entries instead of returning an ambiguous snapshot", async () => {
    const instance = createBroker({
      "account.status": () => ({
        balances: [
          { asset: "BTC", free: "1", locked: "0" },
          { asset: "btc", free: "2", locked: "0" },
        ],
      }),
    })

    const result = await instance.getBalances()

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /duplicate balance asset/)
  })
})
