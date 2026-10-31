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

const trade = {
  id: 11,
  orderId: 7,
  symbol: "BTCUSDT",
  price: "65000.12000000",
  qty: "0.00010001",
  quoteQty: "6.5060120012",
  commission: "0.00000001",
  commissionAsset: "BNB",
  isBuyer: true,
  isMaker: false,
  time: 1_798_000_000_000,
}

describe("BinanceSdkBroker reconciliation ports", () => {
  it("returns exchange server time from the WebSocket API time method", async () => {
    const broker = createBroker({
      time: (params) => {
        assert.deepEqual(params, {})
        return { serverTime: 1_798_000_000_123 }
      },
    })
    const result = await broker.getServerTime()
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, { serverTime: 1_798_000_000_123 })
  })

  it("rejects invalid server timestamps", async () => {
    for (const serverTime of [undefined, -1, 1.5, "1798000000123"]) {
      const broker = createBroker({ time: () => ({ serverTime }) })
      assert.equal((await broker.getServerTime()).ok, false)
    }
  })

  it("returns canonical balances and the exact account source updateTime", async () => {
    const broker = createBroker({
      "account.status": (params, options) => {
        assert.deepEqual(params, { omitZeroBalances: false })
        assert.deepEqual(options, { signed: true })
        return {
          updateTime: 1_798_000_000_321,
          balances: [
            { asset: "BTC", free: "0.200000000000000001", locked: "0.050000000000000009" },
            { asset: "USDT", free: "0", locked: "0" },
          ],
        }
      },
    })
    const result = await broker.getAccountSnapshot()
    assert.equal(result.ok, true)
    assert.equal(result.data.sourceTime, 1_798_000_000_321)
    assert.equal(result.data.balances.length, 2)
    assert.ok(result.data.balances.every((balance) => balance instanceof Balance))
    assert.equal(result.data.balances[0].total.amount, "0.25000000000000001")
    assert.equal(result.data.balances[1].total.amount, "0")
  })

  it("fails closed for missing account timestamps and malformed balances", async () => {
    for (const account of [
      { balances: [] },
      { updateTime: -1, balances: [] },
      { updateTime: 1.5, balances: [] },
      { updateTime: 100, balances: null },
      { updateTime: 100, balances: [{ asset: "BTC", free: "1" }] },
    ]) {
      const broker = createBroker({ "account.status": () => account })
      assert.equal((await broker.getAccountSnapshot()).ok, false)
    }
  })
})
