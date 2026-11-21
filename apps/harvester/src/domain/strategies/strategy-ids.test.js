import assert from "node:assert/strict"
import test from "node:test"
import { StrategyId, normalizeStrategyId } from "./strategy-ids.js"

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

test("normalizes valid strategy IDs without restricting future strategies", () => {
  assert.equal(
    normalizeStrategyId({ strategyId: "  future_strategy  " }),
    "future_strategy",
    "A valid future strategy ID must be normalized by trimming whitespace without requiring current registry membership.",
  )
  assert.equal(
    normalizeStrategyId({ strategyId: StrategyId.COIN_GRABBER }),
    StrategyId.COIN_GRABBER,
    "Canonical persisted strategy IDs must remain byte-for-byte unchanged during normalization.",
  )
})

test("rejects missing, blank, and non-string strategy IDs", () => {
  for (const invalidStrategyId of [undefined, null, "", "   ", 42, {}]) {
    assert.throws(
      () => normalizeStrategyId({ strategyId: invalidStrategyId }),
      TypeError,
      "Strategy identity normalization must reject missing, blank, and non-string values instead of producing an ambiguous owner.",
    )
  }
})
