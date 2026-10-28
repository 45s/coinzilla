import test from "node:test"
import assert from "node:assert/strict"

import { calculateBuyThreshold } from "./helpers.js"

test("calculateBuyThreshold applies a percentage drop to the initial reference price", () => {
  const threshold = calculateBuyThreshold({
    referencePrice: 0.07929,
    lastBuyPrice: null,
    priceStepPercent: 0.05,
  })

  assert.ok(Math.abs(threshold - 0.079250355) < 1e-12)
})

test("calculateBuyThreshold uses the last buy price when available", () => {
  const threshold = calculateBuyThreshold({
    referencePrice: 0.07929,
    lastBuyPrice: 0.08,
    priceStepPercent: 0.05,
  })

  assert.ok(Math.abs(threshold - 0.07996) < 1e-12)
})

test("calculateBuyThreshold preserves the configured percentage at different price levels", () => {
  const threshold = calculateBuyThreshold({
    referencePrice: 100,
    lastBuyPrice: null,
    priceStepPercent: 0.05,
  })

  assert.equal(threshold, 99.95)
})

test("calculateBuyThreshold rejects invalid prices and percentages", () => {
  for (const priceStepPercent of [0, -0.05, 100, 101, Number.NaN]) {
    assert.throws(() =>
      calculateBuyThreshold({
        referencePrice: 0.07929,
        lastBuyPrice: null,
        priceStepPercent,
      }),
    )
  }

  assert.throws(() =>
    calculateBuyThreshold({
      referencePrice: 0,
      lastBuyPrice: null,
      priceStepPercent: 0.05,
    }),
  )
})
