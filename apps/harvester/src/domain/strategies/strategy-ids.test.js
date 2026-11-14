import assert from "node:assert/strict"
import test from "node:test"
import { StrategyId } from "./strategy-ids.js"

test("StrategyId exposes stable identifiers for registered strategies", () => {
  assert.deepEqual(StrategyId, {
    COIN_GRABBER: "CG_coinGrabber",
    RECOVERY_SELLER: "RS_recoverySeller",
  })
})

test("StrategyId is immutable", () => {
  assert.equal(Object.isFrozen(StrategyId), true)
  assert.throws(() => {
    StrategyId.COIN_GRABBER = "changed"
  }, TypeError)
})
