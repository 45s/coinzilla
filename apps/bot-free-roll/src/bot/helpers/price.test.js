import test from "node:test"
import assert from "node:assert/strict"

import { calculateBuyThreshold, roundPriceDown, roundPriceUp, roundQuantityDown } from "./price.js"

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

test("calculateBuyThreshold avoids binary floating-point artifacts", () => {
  const threshold = calculateBuyThreshold({
    referencePrice: 1.554,
    lastBuyPrice: null,
    priceStepPercent: 0.05,
  });

  assert.equal(threshold, 1.553223);
  assert.equal(String(threshold), "1.553223");
});

test("tick and step rounding uses exact decimal increments", () => {
  assert.equal(roundPriceDown(1.5532230000000002, 0.001), 1.553);
  assert.equal(roundPriceUp(1.5530000000000002, 0.001), 1.554);
  assert.equal(roundQuantityDown(0.3, 0.1), 0.3);
  assert.equal(roundQuantityDown(0.29999999999999993, 0.1), 0.2);
});


import {
  calculateBuyThresholdExact,
  calculatePercentageDropExact,
} from "./price.js"

test("exact percentage drop uses decimal arithmetic and preserves small values", () => {
  assert.equal(
    calculatePercentageDropExact({ price: "100", percent: "0.05" }),
    "99.95",
  )
  assert.equal(
    calculatePercentageDropExact({ price: "0.000001", percent: "0.1" }),
    "0.000000999",
  )
})

test("exact percentage drop rejects missing, malformed, and out-of-range inputs", () => {
  for (const input of [
    {},
    { price: "0", percent: "1" },
    { price: "-1", percent: "1" },
    { price: "1", percent: "0" },
    { price: "1", percent: "100" },
    { price: "1", percent: "100.01" },
    { price: "not-a-price", percent: "1" },
    { price: "1", percent: "not-a-percent" },
    { price: 1, percent: "1" },
  ]) {
    assert.throws(() => calculatePercentageDropExact(input))
  }
})

test("exact buy threshold prefers the last buy price and falls back to reference price", () => {
  assert.equal(
    calculateBuyThresholdExact({
      referencePrice: "100",
      lastBuyPrice: "80",
      priceStepPercent: "0.1",
    }),
    "79.92",
  )
  assert.equal(
    calculateBuyThresholdExact({
      referencePrice: "100",
      lastBuyPrice: null,
      priceStepPercent: "0.1",
    }),
    "99.9",
  )
})

test("exact buy threshold rejects absent or invalid base prices and price steps", () => {
  for (const input of [
    {},
    { referencePrice: "0", lastBuyPrice: null, priceStepPercent: "1" },
    { referencePrice: "100", lastBuyPrice: null, priceStepPercent: "0" },
    { referencePrice: "100", lastBuyPrice: null, priceStepPercent: "100" },
    { referencePrice: "100", lastBuyPrice: "invalid", priceStepPercent: "1" },
    { referencePrice: "100", lastBuyPrice: null, priceStepPercent: "invalid" },
  ]) {
    assert.throws(() => calculateBuyThresholdExact(input))
  }
})

test("price and quantity rounding handles zero increments without exceeding precision", () => {
  assert.equal(roundPriceDown(1.123456789, 0), 1.12345678)
  assert.equal(roundPriceUp(1.123456781, 0), 1.12345679)
  assert.equal(roundQuantityDown(0, 0), 0)
})

test("price and quantity rounding rejects non-finite and invalid values", () => {
  for (const invalidValue of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.throws(() => roundPriceDown(invalidValue, 0.01))
    assert.throws(() => roundPriceUp(invalidValue, 0.01))
  }

  for (const invalidQuantity of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.throws(() => roundQuantityDown(invalidQuantity, 0.01))
  }

  for (const invalidIncrement of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.throws(() => roundPriceDown(1, invalidIncrement))
    assert.throws(() => roundPriceUp(1, invalidIncrement))
    assert.throws(() => roundQuantityDown(1, invalidIncrement))
  }

  assert.throws(() => roundPriceDown(0, 0.01))
  assert.throws(() => roundPriceUp(-0.01, 0.01))
})
