import assert from "node:assert/strict"
import test from "node:test"

import { addDecimal } from "@coinzilla/utils"
import { estimateBuyAccounting } from "./accounting.js"

test("Free-Roll accounting uses shared exact decimal arithmetic for quote totals", () => {
  let cycleCost = "0"

  for (let fill = 0; fill < 100; fill += 1) {
    const accounting = estimateBuyAccounting({
      quantity: 0.1,
      price: 0.1,
      feeRate: 0,
    })
    cycleCost = addDecimal({ left: cycleCost, right: accounting.estimatedCost })
  }

  assert.equal(cycleCost, "1")
})

test("shared decimal addition remains exact for financial-sized values", () => {
  assert.equal(
    addDecimal({
      left: "12345678901234567890.12345678",
      right: "0.00000001",
    }),
    "12345678901234567890.12345679",
  )
})
