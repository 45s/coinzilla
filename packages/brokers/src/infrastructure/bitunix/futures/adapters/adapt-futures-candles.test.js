import assert from "node:assert/strict"
import test from "node:test"

import { adaptFuturesCandles } from "./adapt-futures-candles.js"

test("adaptFuturesCandles derives fixed-interval close time and retains exact decimals", () => {
  const candles = adaptFuturesCandles({
    symbol: "BTCUSDT",
    interval: "1h",
    endTime: 1_700_003_600_000,
    rows: [{
      time: 1_700_000_000_000,
      open: "100.10",
      high: "101.20",
      low: "99.90",
      close: "100.80",
      baseVol: "12.3400",
      quoteVol: "1240.000",
    }],
  })

  assert.equal(candles.length, 1, "one kline row must produce one normalized candle")
  assert.equal(candles[0].closeTime, 1_700_003_599_999, "fixed candle close time must be derived from the interval")
  assert.equal(candles[0].volume, "12.3400", "base volume must retain its exact decimal string")
  assert.equal(candles[0].isClosed, true, "the Futures kline endpoint returns closed candles only")
})

test("adaptFuturesCandles uses calendar month boundaries for monthly candles", () => {
  const candles = adaptFuturesCandles({
    symbol: "BTCUSDT",
    interval: "1M",
    rows: [{
      time: Date.UTC(2024, 0, 1),
      open: "1",
      high: "2",
      low: "1",
      close: "2",
      baseVol: "0",
      quoteVol: "0",
    }],
  })

  assert.equal(candles[0].closeTime, Date.UTC(2024, 1, 1) - 1, "monthly close time must use the next UTC calendar month")
})

test("adaptFuturesCandles rejects inconsistent OHLC data and duplicate open times", () => {
  const invalidCandle = {
    time: 1_700_000_000_000,
    open: "100",
    high: "99",
    low: "101",
    close: "100",
    baseVol: "1",
    quoteVol: "100",
  }
  const input = {
    symbol: "BTCUSDT",
    interval: "1h",
    rows: [invalidCandle],
  }
  assert.throws(
    () => adaptFuturesCandles(input),
    /OHLC values are inconsistent/,
    "invalid high/low relationships must be rejected",
  )
  const duplicateRows = [
    { ...invalidCandle, high: "101", low: "99" },
    { ...invalidCandle, high: "101", low: "99" },
  ]
  assert.throws(
    () => adaptFuturesCandles({
      ...input,
      rows: duplicateRows,
    }),
    /duplicate open time/,
    "duplicate candle identities must be rejected",
  )
})
