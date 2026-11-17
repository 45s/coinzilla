import test from "node:test"
import assert from "node:assert/strict"
import { isCanonicalNonNegativeSafeInteger } from "./is-canonical-non-negative-safe-integer.js"

test("accepts canonical non-negative safe integers", () => {
  for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) {
    assert.equal(isCanonicalNonNegativeSafeInteger(value), true, `The canonical timestamp validator must accept the valid non-negative safe integer ${String(value)}.`)
  }
})

test("rejects negative zero, negative, fractional, unsafe, and non-number values", () => {
  for (const value of [-0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "0", null]) {
    assert.equal(isCanonicalNonNegativeSafeInteger(value), false, `The canonical timestamp validator must reject non-canonical input ${String(value)}.`)
  }
})
