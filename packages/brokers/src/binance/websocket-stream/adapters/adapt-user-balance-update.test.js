import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { adaptUser } from "./user.js"

describe("adaptUser.balanceUpdate", () => {
  it("maps asset delta and timestamps", () => {
    assert.deepEqual(adaptUser.balanceUpdate({
      e: "balanceUpdate", a: "USDT", d: "-12.50", T: 200, E: 201,
    }), {
      asset: "USDT", balanceDelta: "-12.50", clearTime: 200,
      eventTime: 201, eventType: "balanceUpdate",
    })
  })
})