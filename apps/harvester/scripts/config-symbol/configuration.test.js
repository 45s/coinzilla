import test from "node:test"
import assert from "node:assert/strict"
import {
  normalizeSymbolInput,
  normalizeTradingEnvironment,
} from "./configuration.js"

test("normalizes a valid Binance symbol and rejects malformed symbols", () => {
  assert.equal(normalizeSymbolInput(" polusdt "), "POLUSDT", "The symbol should be trimmed and normalized to uppercase.")
  for (const value of ["", "   ", "POL/USDT", "POL-USDT", "POL USDT", "POL.USDT", "POL_USDT", null, 42]) {
    assert.throws(
      () => normalizeSymbolInput(value),
      /symbol/i,
      "Malformed symbols must be rejected instead of being sent to Binance: " + String(value),
    )
  }
})

test("accepts only Binance testnet and live metadata environments", () => {
  assert.equal(normalizeTradingEnvironment(" testnet "), "testnet", "TESTNET should normalize safely.")
  assert.equal(normalizeTradingEnvironment("LIVE"), "live", "LIVE should normalize case-insensitively.")
  for (const value of ["", "paper", "production", null, 42]) {
    assert.throws(
      () => normalizeTradingEnvironment(value),
      /environment.*testnet or live/i,
      "Unsupported exchange environments must be rejected before any network request.",
    )
  }
})
