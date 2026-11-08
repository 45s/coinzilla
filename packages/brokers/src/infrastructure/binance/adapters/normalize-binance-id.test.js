import test from "node:test"
import assert from "node:assert/strict"
import { normalizeBinanceId } from "../../index.js"

test("normalizes exact Binance IDs to strings", () => {
  assert.equal(normalizeBinanceId("123456"), "123456")
  assert.equal(normalizeBinanceId(123456), "123456")
})

test("rejects malformed, negative, fractional, and unsafe IDs", () => {
  for (const value of ["", " 1", "1.0", "-1", "1e3", -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => normalizeBinanceId(value, "orderId"), /exact non-negative integer|safe integer/)
  }
})
