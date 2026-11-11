import assert from "node:assert/strict"
import test from "node:test"

import { adaptPublicStreamMessage } from "./public-stream-adapters.js"

test("adapts aggregate trade events using the existing pure adapter", () => {
  const event = {
    e: "aggTrade",
    E: 100,
    T: 99,
    s: "BTCUSDT",
    p: "65000.1000",
    q: "0.2500",
    m: true,
    M: false,
    a: 123,
    f: 120,
    l: 124,
  }

  assert.deepEqual(adaptPublicStreamMessage(event), {
    eventType: "aggTrade",
    eventTime: 100,
    timestamp: 99,
    symbol: "BTCUSDT",
    price: "65000.1000",
    quantity: "0.2500",
    isBuyerMaker: true,
    wasBestPrice: false,
    aggId: 123,
    firstId: 120,
    lastId: 124,
  })
  assert.equal(event.e, "aggTrade")
  assert.equal(event.p, "65000.1000")
})

test("normalizes Kline events through the shared candle adapter", () => {
  const event = {
    e: "kline",
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

  assert.deepEqual(adaptPublicStreamMessage(event), {
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
  assert.equal(event.e, "kline")
})

test("passes through other public market-data events unchanged", () => {
  for (const event of [
    { e: "trade", s: "BTCUSDT", p: "1.00" },

    { e: "24hrMiniTicker", s: "BTCUSDT", c: "1.00" },
    { e: "bookTicker", s: "BTCUSDT", b: "1.00" },
    { e: "depthUpdate", s: "BTCUSDT", b: [], a: [] },
    { e: "unknownPublicEvent", value: 1 },
    { e: "toString", value: 2 },
  ]) {
    assert.equal(adaptPublicStreamMessage(event), event)
  }
})

test("rejects authenticated user-data events at the public adapter boundary", () => {
  for (const eventType of [
    "executionReport",
    "outboundAccountPosition",
    "account",
    "balanceUpdate",
    "listStatus",
  ]) {
    assert.throws(
      () => adaptPublicStreamMessage({ e: eventType }),
      /not public market-data events/,
    )
  }
})

test("rejects non-object event payloads", () => {
  for (const value of [null, undefined, "event", 1, [], true]) {
    assert.throws(() => adaptPublicStreamMessage(value), /event object/)
  }
})
