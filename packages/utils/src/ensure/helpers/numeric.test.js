import assert from "node:assert/strict"
import test from "node:test"
import {
  validateBounds,
  requireIntegerInRange,
  requireNumberInRange,
} from "./numeric.js"

test("validates inclusive bounds", () => {
  assert.deepEqual(validateBounds({ min: 1, max: 5 }), { min: 1, max: 5 })
  assert.deepEqual(validateBounds({ min: 1, max: 5, integer: true }), { min: 1, max: 5 })
  assert.throws(() => validateBounds({ min: 5, max: 1 }), TypeError)
  assert.throws(() => validateBounds({ min: 1.1, max: 5, integer: true }), TypeError)
})

test("requires safe integers within inclusive range", () => {
  assert.equal(requireIntegerInRange({ value: 3, min: 1, max: 5, name: "count" }), 3)
  assert.throws(() => requireIntegerInRange({ value: 1.5, min: 1, max: 5, name: "count" }), TypeError)
  assert.throws(() => requireIntegerInRange({ value: 6, min: 1, max: 5, name: "count" }), RangeError)
})

test("requires finite numbers within inclusive range", () => {
  assert.equal(requireNumberInRange({ value: 2.5, min: 1, max: 5, name: "amount" }), 2.5)
  assert.throws(() => requireNumberInRange({ value: Infinity, min: 1, max: 5, name: "amount" }), TypeError)
  assert.throws(() => requireNumberInRange({ value: 0, min: 1, max: 5, name: "amount" }), RangeError)
})
