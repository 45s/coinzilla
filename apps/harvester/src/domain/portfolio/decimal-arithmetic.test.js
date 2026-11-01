import test from "node:test"
import assert from "node:assert/strict"
import { addDecimalStrings, negateDecimalString, subtractDecimalStrings } from "./decimal-arithmetic.js"

test("adds exact decimal strings with different scales", () => {
  assert.equal(addDecimalStrings({ left: "0.1", right: "0.02000" }), "0.12")
  assert.equal(addDecimalStrings({ left: "999999999999999999", right: "1" }), "1000000000000000000")
})

test("subtracts exact decimal strings and keeps signed results", () => {
  assert.equal(subtractDecimalStrings({ left: "1", right: "0.125" }), "0.875")
  assert.equal(subtractDecimalStrings({ left: "0.1", right: "0.2" }), "-0.1")
  assert.equal(subtractDecimalStrings({ left: "1.00", right: "1" }), "0")
})

test("negates signed values and canonical zero", () => {
  assert.equal(negateDecimalString({ value: "0.00" }), "0")
  assert.equal(negateDecimalString({ value: "-1.25" }), "1.25")
})

test("rejects non-decimal operands", () => {
  assert.throws(() => addDecimalStrings({ left: 1, right: "2" }), /decimal string/)
})
