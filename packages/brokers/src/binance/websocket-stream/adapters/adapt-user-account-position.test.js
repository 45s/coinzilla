import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { adaptUser } from "./user.js"

describe("adaptUser.outboundAccountPosition", () => {
  it("maps balances and account update timestamps", () => {
    assert.deepEqual(adaptUser.outboundAccountPosition({
      e: "outboundAccountPosition", E: 300, u: 299,
      B: [
        { a: "BTC", f: "0.0100", l: "0.0020" },
        { a: "USDT", f: "12.50", l: "0.00" },
      ],
    }), {
      balances: [
        { asset: "BTC", free: "0.0100", locked: "0.0020" },
        { asset: "USDT", free: "12.50", locked: "0.00" },
      ],
      eventTime: 300, eventType: "outboundAccountPosition", lastAccountUpdate: 299,
    })
  })
})