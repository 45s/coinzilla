import test from "node:test"
import assert from "node:assert/strict"
import { waitStrategy } from "./wait-strategy.js"

test("returns WAIT and never requests an order", () => {
  const marketPrice = { symbol: "BTCUSDT", price: "65000.12", timestamp: 123 }

  assert.deepEqual(waitStrategy.evaluate({ marketPrice }), {
    action: "WAIT",
    reason: "No trading strategy is configured",
    symbol: "BTCUSDT",
  })
})
