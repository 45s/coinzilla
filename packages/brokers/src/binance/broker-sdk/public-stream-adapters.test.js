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

test("passes through other public market-data events unchanged", () => {
  for (const event of [
    { e: "trade", s: "BTCUSDT", p: "1.00" },
    { e: "kline", s: "BTCUSDT", k: { i: "1m" } },
    { e: "24hrMiniTicker", s: "BTCUSDT", c: "1.00" },
    { e: "bookTicker", s: "BTCUSDT", b: "1.00" },
    { e: "depthUpdate", s: "BTCUSDT", b: [], a: [] },
    { e: "unknownPublicEvent", value: 1 },
  ]) {
    assert.equal(adaptPublicStreamMessage(event), event)
  }
})

test("does not accept authenticated user-data events as public market data", () => {
  const event = { e: "executionReport", s: "BTCUSDT" }
  assert.equal(adaptPublicStreamMessage(event), event)
})

test("rejects non-object event payloads", () => {
  for (const value of [null, undefined, "event", 1, [], true]) {
    assert.throws(() => adaptPublicStreamMessage(value), /event object/)
  }
})
