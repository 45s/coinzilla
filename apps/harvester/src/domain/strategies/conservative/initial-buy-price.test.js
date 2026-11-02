import test from "node:test"
import assert from "node:assert/strict"
import { calculateInitialBuyPrice } from "./initial-buy-price.js"

test("calculates the initial BUY limit using percentage points and rounds down to tick", () => {
  const result = calculateInitialBuyPrice({
    lastTradePrice: "0.07929",
    priceStepPercent: "0.05",
    priceTickSize: "0.00001",
  })

  assert.deepEqual(result, { price: "0.07925" })
})

test("calculates a larger percentage decrease exactly", () => {
  const result = calculateInitialBuyPrice({
    lastTradePrice: "100",
    priceStepPercent: "1",
    priceTickSize: "0.01",
  })

  assert.deepEqual(result, { price: "99" })
})

test("does not round a price up when the calculated value is between ticks", () => {
  const result = calculateInitialBuyPrice({
    lastTradePrice: "1",
    priceStepPercent: "0.05",
    priceTickSize: "0.001",
  })

  assert.deepEqual(result, { price: "0.999" })
})

test("rejects invalid or missing decimal inputs", () => {
  for (const input of [
    {},
    { lastTradePrice: "0", priceStepPercent: "0.05", priceTickSize: "0.00001" },
    { lastTradePrice: "1", priceStepPercent: "0", priceTickSize: "0.00001" },
    { lastTradePrice: "1", priceStepPercent: "100", priceTickSize: "0.00001" },
    { lastTradePrice: "1", priceStepPercent: "0.05", priceTickSize: "0" },
    { lastTradePrice: "1", priceStepPercent: "-0.05", priceTickSize: "0.00001" },
  ]) {
    assert.throws(() => calculateInitialBuyPrice(input))
  }
})

test("rejects a result that rounds down to zero", () => {
  assert.throws(
    () => calculateInitialBuyPrice({
      lastTradePrice: "0.0000001",
      priceStepPercent: "99.9",
      priceTickSize: "0.0000001",
    }),
    /not positive after tick rounding/,
  )
})
