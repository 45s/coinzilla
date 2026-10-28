import test from "node:test"
import assert from "node:assert/strict"

import {
  calculateBuyThreshold,
  getFeeRate,
  calculateSellPlan,
  roundPriceDown,
  roundPriceUp,
  roundQuantityDown,
} from "./helpers.js"

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


test("roundPriceDown returns a valid tick without floating-point noise", () => {
  assert.equal(roundPriceDown(0.07905045499999999, 0.00001), 0.07905)
  assert.equal(roundPriceDown(0.1234, 0.05), 0.1)
})

test("roundPriceUp returns a valid tick without floating-point noise", () => {
  assert.equal(roundPriceUp(0.0790500001, 0.00001), 0.07906)
  assert.equal(roundPriceUp(0.101, 0.05), 0.15)
})


test("roundQuantityDown respects exchange quantity steps", () => {
  assert.equal(roundQuantityDown(391.08910891089107, 1), 391)
  assert.equal(roundQuantityDown(4.999, 0.01), 4.99)
  assert.equal(roundQuantityDown(0.009, 0.01), 0)
})

test("calculateSellPlan rounds quantity down before calculating profitable price", () => {
  const plan = calculateSellPlan({
    activeQuantity: 396,
    keepQuantity: 1,
    cycleCost: 31.8554,
    saleProceeds: 0,
    minProfit: 0.01,
    feeRate: 0.01,
    priceTickSize: 0.00001,
    quantityStepSize: 1,
  })
  assert.equal(plan.quantity, 391)
  assert.equal(plan.price, 0.08233)
})


test("calculateSellPlan returns readable money precision without floating-point noise", () => {
  const plan = calculateSellPlan({
    activeQuantity: 1584,
    keepQuantity: 1,
    cycleCost: 128.00336,
    saleProceeds: 0,
    minProfit: 0.01,
    feeRate: 0.01,
    priceTickSize: 0.00001,
    quantityStepSize: 1,
  })

  assert.equal(plan.quantity, 1567)
  assert.equal(plan.requiredNetProceeds, 128.01336)
  assert.equal(plan.price, 0.08252)
})

test("getFeeRate converts pair commission percentages to a conservative decimal rate", () => {
  assert.equal(getFeeRate({ makerPercent: 0.075, takerPercent: 0.075 }), 0.00075)
  assert.equal(getFeeRate({ makerPercent: 0, takerPercent: 0.075 }), 0.00075)
  assert.equal(getFeeRate({ makerPercent: 0, takerPercent: 0 }), 0)
  assert.equal(getFeeRate({ makerPercent: 0.075, takerPercent: 0.04 }), 0.00075)
})

test("getFeeRate rejects missing or invalid commission percentages", () => {
  for (const value of [undefined, null, -0.01, 100, Number.NaN, Infinity]) {
    assert.throws(() => getFeeRate({ makerPercent: value, takerPercent: 0 }))
    assert.throws(() => getFeeRate({ makerPercent: 0, takerPercent: value }))
  }
})

test("calculateSellPlan uses realistic 0.075% commission without the former 1% assumption", () => {
  const plan = calculateSellPlan({
    activeQuantity: 396,
    keepQuantity: 1,
    cycleCost: 31.8554,
    saleProceeds: 0,
    minProfit: 0.01,
    feeRate: getFeeRate({ makerPercent: 0.075, takerPercent: 0.075 }),
    priceTickSize: 0.00001,
    quantityStepSize: 1,
  })

  assert.equal(plan.quantity, 394)
  assert.equal(plan.price, 0.08094)
})
