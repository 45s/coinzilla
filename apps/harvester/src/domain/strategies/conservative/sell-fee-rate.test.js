import test from "node:test"
import assert from "node:assert/strict"
import { calculateSellFeeRate } from "./sell-fee-rate.js"

test("reserves zero when both configured execution fees are zero", () => {
  assert.deepEqual(
    calculateSellFeeRate({ makerPercent: "0", takerPercent: "0" }),
    { feeRate: "0", reservedPercent: "0", reservedRole: "MAKER" },
  )
})

test("reserves the higher taker fee when taker is more expensive", () => {
  assert.deepEqual(
    calculateSellFeeRate({ makerPercent: "0.075", takerPercent: "0.1" }),
    { feeRate: "0.001", reservedPercent: "0.1", reservedRole: "TAKER" },
  )
})

test("reserves the higher maker fee when maker is more expensive", () => {
  assert.deepEqual(
    calculateSellFeeRate({ makerPercent: "0.2", takerPercent: "0.1" }),
    { feeRate: "0.002", reservedPercent: "0.2", reservedRole: "MAKER" },
  )
})

test("reserves equal maker and taker fees", () => {
  assert.deepEqual(
    calculateSellFeeRate({ makerPercent: "0.1", takerPercent: "0.1" }),
    { feeRate: "0.001", reservedPercent: "0.1", reservedRole: "MAKER" },
  )
})

test("rejects invalid maker or taker percentages", () => {
  for (const makerPercent of ["-0.1", "100", "not-a-number", undefined]) {
    assert.throws(() => calculateSellFeeRate({ makerPercent, takerPercent: "0.1" }))
  }
  for (const takerPercent of ["-0.1", "100", "not-a-number", undefined]) {
    assert.throws(() => calculateSellFeeRate({ makerPercent: "0.1", takerPercent }))
  }
})
