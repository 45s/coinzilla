import test from "node:test"
import assert from "node:assert/strict"
import { calculateSellFeeRate } from "./sell-fee-rate.js"

test("uses zero planning commission when makerPercent is zero", () => {
  assert.deepEqual(calculateSellFeeRate({ makerPercent: "0" }), { feeRate: "0" })
})

test("converts non-zero makerPercent directly into the planning commission rate", () => {
  assert.deepEqual(calculateSellFeeRate({ makerPercent: "0.1" }), { feeRate: "0.001" })
})

test("planning commission is independent of takerPercent and observed fill fees", () => {
  const expected = { feeRate: "0.001" }
  assert.deepEqual(calculateSellFeeRate({ makerPercent: "0.1" }), expected)
  assert.deepEqual(calculateSellFeeRate({ makerPercent: "0.1", takerPercent: "0.2" }), expected)
  assert.deepEqual(calculateSellFeeRate({
    makerPercent: "0.1",
    takerPercent: "0.2",
    observedCommissionRates: ["0.01"],
  }), expected)
})

test("rejects invalid maker percentages", () => {
  for (const makerPercent of ["-0.1", "100", "not-a-number", undefined]) {
    assert.throws(() => calculateSellFeeRate({ makerPercent }))
  }
})
