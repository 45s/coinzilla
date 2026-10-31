import test from "node:test"
import assert from "node:assert/strict"

import { calculateGridSellInventoryPlan } from "./grid-sell-inventory.js"

test("reserves gross SELL quantity plus configured base-asset fee coverage", () => {
  const result = calculateGridSellInventoryPlan({
    availableQuantity: "100",
    keepQuantity: "1",
    feeRate: "0.001",
    quantityStepSize: "0.01",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, {
    quantity: "98.9",
    reservedQuantity: "98.9989",
    sellableQuantity: "99",
    unreservedQuantity: "0.0011",
  })
})

test("preserves the full sellable quantity when the configured fee rate is zero", () => {
  const result = calculateGridSellInventoryPlan({
    availableQuantity: "100",
    keepQuantity: "1",
    feeRate: "0",
    quantityStepSize: "0.01",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, {
    quantity: "99",
    reservedQuantity: "99",
    sellableQuantity: "99",
    unreservedQuantity: "0",
  })
})

test("keeps quantity-step dust outside the SELL reservation and free allocation", () => {
  const result = calculateGridSellInventoryPlan({
    availableQuantity: "10",
    keepQuantity: "1",
    feeRate: "0",
    quantityStepSize: "0.3",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, {
    quantity: "9",
    reservedQuantity: "9",
    sellableQuantity: "9",
    unreservedQuantity: "0",
  })
})

test("returns zero SELL quantity when only keep inventory remains", () => {
  const result = calculateGridSellInventoryPlan({
    availableQuantity: "1",
    keepQuantity: "1",
    feeRate: "0",
    quantityStepSize: "0.01",
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.quantity, "0")
  assert.equal(result.data.reservedQuantity, "0")
  assert.equal(result.data.unreservedQuantity, "0")
})

test("rejects invalid decimal inputs and negative or excessive fee rates", () => {
  const base = {
    availableQuantity: "100",
    keepQuantity: "1",
    feeRate: "0.001",
    quantityStepSize: "0.01",
  }
  const invalid = [
    { ...base, availableQuantity: "-1" },
    { ...base, keepQuantity: "-1" },
    { ...base, feeRate: "-0.01" },
    { ...base, feeRate: "1" },
    { ...base, quantityStepSize: "-0.01" },
    { ...base, availableQuantity: "not-a-number" },
  ]

  for (const input of invalid) {
    assert.equal(calculateGridSellInventoryPlan(input).ok, false)
  }
})
