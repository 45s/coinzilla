import assert from "node:assert/strict"
import test from "node:test"

import { adaptKlineHistoryRow, adaptKlineStreamMessage } from "./adapt-kline.js"

const historyRow = [
  1_700_000_000_000,
  "1.0000",
  "2.0000",
  "0.5000",
  "1.5000",
  "10.0000",
  1_700_000_059_999,
  "15.0000",
  10,
  "5.0000",
  "7.5000",
  "0",
]

const streamMessage = {
  e: "kline",
  E: 1_700_000_059_000,
  s: "BTCUSDT",
  k: {
    t: 1_700_000_000_000,
    T: 1_700_000_059_999,
    s: "BTCUSDT",
    i: "1m",
    o: "1.0000",
    h: "2.0000",
    l: "0.5000",
    c: "1.5000",
    v: "10.0000",
    x: false,
  },
}

test("normalizes historical Kline rows and preserves exact decimal strings", () => {
  const candle = adaptKlineHistoryRow({
    row: historyRow,
    symbol: "btcusdt",
    interval: "1m",
    now: 1_700_000_060_000,
  })

  assert.deepEqual(candle, {
    symbol: "BTCUSDT",
    interval: "1m",
    openTime: 1_700_000_000_000,
    closeTime: 1_700_000_059_999,
    open: "1.0000",
    high: "2.0000",
    low: "0.5000",
    close: "1.5000",
    volume: "10.0000",
    isClosed: true,
  })
  assert.equal(Object.isFrozen(candle), true)
})

test("marks a still-forming historical candle as open", () => {
  const candle = adaptKlineHistoryRow({
    row: historyRow,
    symbol: "BTCUSDT",
    interval: "1m",
    now: 1_700_000_059_998,
  })
  assert.equal(candle.isClosed, false)
})

test("normalizes live Kline events and preserves their close flag", () => {
  const candle = adaptKlineStreamMessage(streamMessage)
  assert.deepEqual(candle, {
    symbol: "BTCUSDT",
    interval: "1m",
    openTime: 1_700_000_000_000,
    closeTime: 1_700_000_059_999,
    open: "1.0000",
    high: "2.0000",
    low: "0.5000",
    close: "1.5000",
    volume: "10.0000",
    isClosed: false,
  })
  assert.equal(Object.isFrozen(candle), true)
})

test("rejects invalid history row shapes and timestamps", () => {
  assert.throws(() => adaptKlineHistoryRow({ row: null, symbol: "BTCUSDT", interval: "1m" }), /exactly 12 fields/)
  assert.throws(() => adaptKlineHistoryRow({ row: historyRow.slice(0, 11), symbol: "BTCUSDT", interval: "1m" }), /exactly 12 fields/)
  assert.throws(() => adaptKlineHistoryRow({ row: [NaN, ...historyRow.slice(1)], symbol: "BTCUSDT", interval: "1m" }), /openTime/)
  assert.throws(() => adaptKlineHistoryRow({ row: [historyRow[0], ...historyRow.slice(1, 6), historyRow[0] - 1, ...historyRow.slice(7)], symbol: "BTCUSDT", interval: "1m" }), /closeTime/)
  assert.throws(() => adaptKlineHistoryRow({ row: historyRow, symbol: "BTCUSDT", interval: "1m", now: -1 }), /now/)
})

test("rejects malformed live Kline events and symbol mismatches", () => {
  for (const message of [null, [], "kline", { e: "aggTrade" }]) {
    assert.throws(() => adaptKlineStreamMessage(message), /Kline event is required/)
  }
  assert.throws(() => adaptKlineStreamMessage({ ...streamMessage, k: null }), /kline object/)
  assert.throws(() => adaptKlineStreamMessage({
    ...streamMessage,
    k: { ...streamMessage.k, s: "ETHUSDT" },
  }), /symbol does not match/)
  assert.throws(() => adaptKlineStreamMessage({
    ...streamMessage,
    k: { ...streamMessage.k, x: "false" },
  }), /isClosed must be a boolean/)
})

test("rejects missing or unsupported symbols and intervals", () => {
  assert.throws(() => adaptKlineHistoryRow({ row: historyRow, interval: "1m" }), /non-empty symbol/)
  assert.throws(() => adaptKlineHistoryRow({ row: historyRow, symbol: "BTCUSDT", interval: "2m" }), /supported Binance kline interval/)
  assert.throws(() => adaptKlineStreamMessage({
    ...streamMessage,
    k: { ...streamMessage.k, i: "2m" },
  }), /supported Binance kline interval/)
})

test("validates exact positive prices, non-negative volume and OHLC relationships", () => {
  for (const field of ["open", "high", "low", "close", "volume"]) {
    const index = { open: 1, high: 2, low: 3, close: 4, volume: 5 }[field]
    const invalid = [...historyRow]
    invalid[index] = 1
    assert.throws(() => adaptKlineHistoryRow({
      row: invalid, symbol: "BTCUSDT", interval: "1m", now: 1_700_000_060_000,
    }), /decimal/)
  }

  for (const [index, value, pattern] of [
    [1, "0", /must be positive/],
    [5, "-1", /volume must be non-negative/],
    [2, "0.4", /high must be greater/],
    [3, "1.1", /low must be less/],
  ]) {
    const invalid = [...historyRow]
    invalid[index] = value
    assert.throws(() => adaptKlineHistoryRow({
      row: invalid, symbol: "BTCUSDT", interval: "1m", now: 1_700_000_060_000,
    }), pattern)
  }
})

test("rejects a close time before the open time", () => {
  const invalid = [...historyRow]
  invalid[6] = invalid[0] - 1
  assert.throws(() => adaptKlineHistoryRow({
    row: invalid, symbol: "BTCUSDT", interval: "1m", now: 1_700_000_060_000,
  }), /closeTime must not be before openTime/)
})
