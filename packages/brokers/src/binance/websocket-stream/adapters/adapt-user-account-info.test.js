import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { adaptUser } from "./user.js"

describe("adaptUser.outboundAccountInfo", () => {
  it("maps account flags and indexes balances by asset", () => {
    assert.deepEqual(adaptUser.outboundAccountInfo({
      e: "outboundAccountInfo", E: 10, m: 1, t: 2, b: 3, s: 4,
      T: true, W: false, D: true, u: 9,
      B: [{ a: "BTC", f: "0.5", l: "0.1" }, { a: "USDT", f: "10", l: "2" }],
    }), {
      eventType: "account", eventTime: 10, makerCommissionRate: 1,
      takerCommissionRate: 2, buyerCommissionRate: 3, sellerCommissionRate: 4,
      canTrade: true, canWithdraw: false, canDeposit: true, lastAccountUpdate: 9,
      balances: { BTC: { available: "0.5", locked: "0.1" }, USDT: { available: "10", locked: "2" } },
    })
  })

  it("uses the last balance when an asset appears more than once", () => {
    const result = adaptUser.outboundAccountInfo({
      E: 1, m: 0, t: 0, b: 0, s: 0, T: false, W: false, D: false, u: 1,
      B: [{ a: "BTC", f: "1", l: "0" }, { a: "BTC", f: "2", l: "0.5" }],
    })
    assert.deepEqual(result.balances, { BTC: { available: "2", locked: "0.5" } })
  })
})