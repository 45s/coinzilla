import assert from "node:assert/strict"
import test from "node:test"

import {
  readOptionalDecimalFilter,
  validatePositiveDecimalFilter,
} from "./symbol-filter-adapters.js"

test("requires a positive decimal filter and preserves its exact source string", () => {
  assert.equal(validatePositiveDecimalFilter({
    value: "0.010000",
    name: "PRICE_FILTER.tickSize",
    symbol: "BTCUSDT",
  }), "0.010000")
})

test("rejects missing, malformed, zero, and negative required filters", () => {
  for (const value of [undefined, null]) {
    assert.throws(() => validatePositiveDecimalFilter({
      value, name: "PRICE_FILTER.tickSize", symbol: "BTCUSDT",
    }), /missing/)
  }
  assert.throws(() => validatePositiveDecimalFilter({
    value: "NaN", name: "PRICE_FILTER.tickSize", symbol: "BTCUSDT",
  }), /is invalid/)
  for (const value of ["0", "-0.01"]) {
    assert.throws(() => validatePositiveDecimalFilter({
      value, name: "PRICE_FILTER.tickSize", symbol: "BTCUSDT",
    }), /non-positive/)
  }
})

test("omits absent optional filters and preserves zero decimal strings", () => {
  assert.equal(readOptionalDecimalFilter({
    value: undefined, name: "PRICE_FILTER.minPrice", symbol: "BTCUSDT",
  }), undefined)
  assert.equal(readOptionalDecimalFilter({
    value: null, name: "PRICE_FILTER.minPrice", symbol: "BTCUSDT",
  }), undefined)
  assert.equal(readOptionalDecimalFilter({
    value: "0.0000", name: "PRICE_FILTER.minPrice", symbol: "BTCUSDT",
  }), "0.0000")
})

test("rejects malformed and negative optional filters", () => {
  assert.throws(() => readOptionalDecimalFilter({
    value: "1e-8", name: "PRICE_FILTER.minPrice", symbol: "BTCUSDT",
  }), /is invalid/)
  assert.throws(() => readOptionalDecimalFilter({
    value: "-0.01", name: "PRICE_FILTER.minPrice", symbol: "BTCUSDT",
  }), /must be non-negative/)
})
