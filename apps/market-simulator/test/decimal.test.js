import assert from "node:assert/strict"
import test from "node:test"
import { addDecimal, compareDecimal, multiplyDecimal, subtractDecimal } from "../src/domain/decimal.js"

test("decimal arithmetic is exact and string based", () => {
  assert.equal(addDecimal("0.1", "0.02"), "0.12")
  assert.equal(subtractDecimal("1.00", "0.09"), "0.91")
  assert.equal(multiplyDecimal("400", "0.0715"), "28.6")
  assert.equal(compareDecimal("0.100000000000000001", "0.1"), 1)
  assert.throws(() => subtractDecimal("0.1", "0.2"), /negative/)
  assert.throws(() => addDecimal(0.1, "0.2"), /must be strings/)
})
