import test from "node:test"
import assert from "node:assert/strict"
import { createMarketPrice } from "./market-price.js"

test("creates an immutable market price without converting decimal precision", () => {
  const marketPrice = createMarketPrice({
    priceEvent: {
      symbol: "BTCUSDT",
      price: "65000.12000000",
      timestamp: 123,
    },
  })

  assert.deepEqual(marketPrice, {
    symbol: "BTCUSDT",
    price: "65000.12000000",
    timestamp: 123,
  })
  assert.equal(Object.isFrozen(marketPrice), true)
})

test("rejects malformed symbols, non-positive prices, and invalid timestamps", () => {
  const valid = { symbol: "BTCUSDT", price: "1.25", timestamp: 123 }

  for (const priceEvent of [
    { ...valid, symbol: "btcusdt" },
    { ...valid, price: "0" },
    { ...valid, price: "0.000" },
    { ...valid, price: "-1" },
    { ...valid, price: 1.25 },
    { ...valid, timestamp: -1 },
    { ...valid, timestamp: 1.5 },
  ]) {
    assert.throws(() => createMarketPrice({ priceEvent }))
  }
})

test("accepts very small positive decimal strings without numeric conversion", () => {
  const marketPrice = createMarketPrice({
    priceEvent: {
      symbol: "BTCUSDT",
      price: "0.0000000000000000000000000000000000001",
      timestamp: 123,
    },
  })

  assert.equal(marketPrice.price, "0.0000000000000000000000000000000000001")
})

test("rejects missing price event", () => {
  assert.throws(() => createMarketPrice(), /priceEvent object/)
})
