import test from "node:test"
import assert from "node:assert/strict"
import { calculateSellFeeRate } from "./sell-fee-rate.js"

test("does not reserve configured fees before any actual commission is observed", () => {
  assert.deepEqual(
    calculateSellFeeRate({
      makerPercent: "0.075",
      takerPercent: "0.1",
    }),
    { feeRate: "0" },
  )
})

test("zero maker rate keeps the reserve at zero when no fill paid a fee", () => {
  assert.deepEqual(
    calculateSellFeeRate({
      makerPercent: "0",
      takerPercent: "0.1",
      observedCommissionRates: ["0", "0"],
    }),
    { feeRate: "0" },
  )
})

test("zero maker rate uses actual observed commission without a taker-rate reserve", () => {
  assert.deepEqual(
    calculateSellFeeRate({
      makerPercent: "0",
      takerPercent: "0.1",
      observedCommissionRates: ["0.00075"],
    }),
    { feeRate: "0.00075" },
  )
})

test("non-zero maker rate activates the higher configured ceiling after a fee is observed", () => {
  assert.deepEqual(
    calculateSellFeeRate({
      makerPercent: "0.075",
      takerPercent: "0.1",
      observedCommissionRates: ["0.0005"],
    }),
    { feeRate: "0.001" },
  )
})

test("actual commission above the configured ceiling takes precedence", () => {
  assert.deepEqual(
    calculateSellFeeRate({
      makerPercent: "0.075",
      takerPercent: "0.1",
      observedCommissionRates: ["0.0012"],
    }),
    { feeRate: "0.0012" },
  )
})

test("a later actual SELL fee can raise the reserve used by subsequent plans", () => {
  assert.deepEqual(
    calculateSellFeeRate({
      makerPercent: "0",
      takerPercent: "0.1",
      observedCommissionRates: ["0.0005", "0.0011"],
    }),
    { feeRate: "0.0011" },
  )
})

test("rejects invalid configured rates and observed values", () => {
  assert.throws(
    () => calculateSellFeeRate({ makerPercent: "-0.1", takerPercent: "0" }),
    /percentages/,
  )
  assert.throws(
    () => calculateSellFeeRate({
      makerPercent: "0",
      takerPercent: "0",
      observedCommissionRates: ["-0.001"],
    }),
    /non-negative/,
  )
  assert.throws(
    () => calculateSellFeeRate({
      makerPercent: "0",
      takerPercent: "0",
      observedCommissionRates: "0.001",
    }),
    /array/,
  )
})
