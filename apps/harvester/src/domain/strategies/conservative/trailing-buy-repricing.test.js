import test from "node:test"
import assert from "node:assert/strict"
import { evaluateTrailingBuyRepricing } from "./trailing-buy-repricing.js"

test("does not reprice until market has risen by one full configured step", () => {
  const result = evaluateTrailingBuyRepricing({
    marketPrice: "100.0499",
    referencePrice: "100",
    priceStepPercent: "0.05",
  })
  assert.deepEqual(result, {
    shouldReplace: false,
    adjustmentThreshold: "100.05",
  })
})

test("reprices when market reaches or exceeds the compounded upward threshold", () => {
  for (const marketPrice of ["100.05", "100.06"]) {
    const result = evaluateTrailingBuyRepricing({
      marketPrice,
      referencePrice: "100",
      priceStepPercent: "0.05",
    })
    assert.equal(result.shouldReplace, true)
  }
})

test("uses the latest replacement reference for the next upward step", () => {
  const result = evaluateTrailingBuyRepricing({
    marketPrice: "100.1101",
    referencePrice: "100.06",
    priceStepPercent: "0.05",
  })
  assert.equal(result.shouldReplace, true)
  assert.equal(result.adjustmentThreshold, "100.11003")
})

test("rejects invalid prices and percentage values", () => {
  for (const input of [
    {},
    { marketPrice: "0", referencePrice: "100", priceStepPercent: "0.05" },
    { marketPrice: "100", referencePrice: "0", priceStepPercent: "0.05" },
    { marketPrice: "100", referencePrice: "100", priceStepPercent: "0" },
    { marketPrice: "100", referencePrice: "100", priceStepPercent: "100" },
  ]) {
    assert.throws(() => evaluateTrailingBuyRepricing(input))
  }
})
