import test from "node:test"
import assert from "node:assert/strict"

import {
  calculateVolatilityMetrics,
  validateCandle,
  validateCandleSeries,
} from "./volatility-candle.js"

const validCandle = Object.freeze({
  symbol: "BTCUSDT",
  interval: "1m",
  openTime: 0,
  closeTime: 59_999,
  open: "1",
  high: "1",
  low: "1",
  close: "1",
  volume: "1",
  isClosed: true,
})

test("validateCandle requires explicit market and interval context", () => {
  assert.throws(
    () => validateCandle({ candle: validCandle, symbol: "", interval: "1m", intervalMs: 60_000 }),
    /symbol must be a non-empty string/,
  )
  assert.throws(
    () => validateCandle({ candle: validCandle, symbol: "BTCUSDT", interval: "", intervalMs: 60_000 }),
    /interval must be a non-empty string/,
  )
  assert.throws(
    () => validateCandle({ candle: validCandle, symbol: "BTCUSDT", interval: "1m", intervalMs: 0 }),
    /intervalMs must be a positive safe integer/,
  )
})

test("validateCandleSeries rejects non-array history before iteration", () => {
  assert.throws(
    () => validateCandleSeries({
      candles: null,
      symbol: "BTCUSDT",
      interval: "1m",
      intervalMs: 60_000,
    }),
    /history must be an array/,
  )
})

test("calculateVolatilityMetrics validates every calculation input before calculating", () => {
  const validInput = {
    candles: [],
    intervalMs: 60_000,
    period: 14,
    referenceObservations: 60,
    indicatorScale: 18,
    ratioScale: 8,
  }
  const invalidInputs = [
    ["candles", null, /candles must be an array/],
    ["intervalMs", 0, /intervalMs must be a positive safe integer/],
    ["period", 0, /period must be a positive integer/],
    ["referenceObservations", 0, /referenceObservations must be a positive integer/],
    ["indicatorScale", -1, /indicatorScale must be an integer/],
    ["indicatorScale", 101, /indicatorScale must be an integer/],
    ["ratioScale", -1, /ratioScale must be an integer/],
    ["ratioScale", 101, /ratioScale must be an integer/],
  ]

  for (const [field, value, expectedError] of invalidInputs) {
    assert.throws(
      () => calculateVolatilityMetrics({ ...validInput, [field]: value }),
      expectedError,
      field + " must be validated",
    )
  }
})


test("rejects negative-zero candle timestamps", () => {
  assert.throws(
    () => validateCandle({
      candle: { ...validCandle, openTime: -0 },
      symbol: "BTCUSDT",
      interval: "1m",
      intervalMs: 60_000,
    }),
    /openTime must align/,
    "A negative-zero candle open time must be rejected as a non-canonical timestamp.",
  )
  assert.throws(
    () => validateCandle({
      candle: { ...validCandle, interval: "1ms", closeTime: -0 },
      symbol: "BTCUSDT",
      interval: "1ms",
      intervalMs: 1,
    }),
    /closeTime does not match/,
    "A negative-zero candle close time must be rejected as a non-canonical timestamp.",
  )
})
