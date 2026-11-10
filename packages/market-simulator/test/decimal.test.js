import assert from "node:assert/strict"
import test from "node:test"

import { addDecimal, compareDecimal, multiplyDecimal, subtractDecimal } from "../src/domain/decimal.js"

test("market simulator delegates exact arithmetic to shared utilities", () => {
  assert.equal(addDecimal({ left: "0.1", right: "0.02" }), "0.12")
  assert.equal(subtractDecimal({ left: "1.00", right: "0.09" }), "0.91")
  assert.equal(multiplyDecimal({ left: "400", right: "0.0715" }), "28.6")
  assert.equal(compareDecimal({ left: "0.100000000000000001", right: "0.1" }), 1)
})

test("market simulator preserves its non-negative subtraction rule", () => {
  assert.throws(() => subtractDecimal({ left: "0.1", right: "0.2" }), /must not be negative/)
})

test("market simulator rejects non-string arithmetic operands", () => {
  assert.throws(() => addDecimal({ left: 0.1, right: "0.2" }), /decimal string/)
})
