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
