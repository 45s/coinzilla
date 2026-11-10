import assert from "node:assert/strict"
import test from "node:test"

import { adaptBookTickerMessage } from "./adapt-book-ticker.js"

const validMessage = {
  e: "bookTicker",
  s: "BTCUSDT",
  b: "65000.10",
  B: "0.25000000",
  a: "65000.11",
  A: "0.50000000",
}

test("maps a matching book ticker into an immutable exact-string snapshot", () => {
  const result = adaptBookTickerMessage({
    message: validMessage,
    symbol: "BTCUSDT",
    timestamp: 1_730_000_000_000,
  })

  assert.deepEqual(result, {
    symbol: "BTCUSDT",
    bestBidPrice: "65000.10",
    bestBidQuantity: "0.25000000",
    bestAskPrice: "65000.11",
    bestAskQuantity: "0.50000000",
    timestamp: 1_730_000_000_000,
  })
  assert.equal(Object.isFrozen(result), true)
})

test("accepts the raw book ticker payload without an event type", () => {
  const { e, ...message } = validMessage
  assert.equal(adaptBookTickerMessage({
    message, symbol: "BTCUSDT", timestamp: 42,
  }).timestamp, 42)
})

test("rejects non-object messages and other event types", () => {
  for (const message of [null, [], "bookTicker", { ...validMessage, e: "aggTrade" }]) {
    assert.throws(() => adaptBookTickerMessage({
      message, symbol: "BTCUSDT", timestamp: 1,
    }), /bookTicker event is required/)
  }
})

test("rejects a symbol that differs from the subscription", () => {
  assert.throws(() => adaptBookTickerMessage({
    message: { ...validMessage, s: "ETHUSDT" },
    symbol: "BTCUSDT",
    timestamp: 1,
  }), /symbol does not match/)
})

test("validates every bid and ask decimal as a positive exact string", () => {
  for (const field of ["b", "B", "a", "A"]) {
    assert.throws(() => adaptBookTickerMessage({
      message: { ...validMessage, [field]: 0.1 },
      symbol: "BTCUSDT",
      timestamp: 1,
    }), /decimal string/)
    assert.throws(() => adaptBookTickerMessage({
      message: { ...validMessage, [field]: "0" },
      symbol: "BTCUSDT",
      timestamp: 1,
    }), /must be positive/)
  }
})
