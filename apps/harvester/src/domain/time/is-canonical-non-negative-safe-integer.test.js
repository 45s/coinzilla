import test from "node:test"
import assert from "node:assert/strict"
import { isCanonicalNonNegativeSafeInteger } from "./is-canonical-non-negative-safe-integer.js"

test("accepts canonical non-negative safe integers", () => {
  for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) {
    assert.equal(isCanonicalNonNegativeSafeInteger(value), true)
  }
})

test("rejects negative zero, negative, fractional, unsafe, and non-number values", () => {
  for (const value of [-0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "0", null]) {
    assert.equal(isCanonicalNonNegativeSafeInteger(value), false, String(value))
  }
})
