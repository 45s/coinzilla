import nodeTest from "node:test"
import assert from "node:assert/strict"
import { evaluateReadOnlyConservativeStrategy } from "./evaluate-read-only-conservative-strategy.js"

const test = (name, ...args) => nodeTest("[evaluate-read-only-conservative-strategy.test.js] " + name, ...args)

test("returns a frozen no-action decision with the current symbol position", () => {
  const position = Object.freeze({ baseQuantity: "0.25" })
  const result = evaluateReadOnlyConservativeStrategy({
    marketPrice: { symbol: "BTCUSDT", price: "65000" },
    portfolio: { getPosition: ({ symbol }) => symbol === "BTCUSDT" ? { value: position } : undefined },
  })

  assert.equal(result.strategy, "CONSERVATIVE", "The read-only fallback must retain the configured strategy identity.")
  assert.equal(result.symbol, "BTCUSDT", "The decision must retain its market symbol.")
  assert.equal(result.action, "NO_ACTION", "Read-only mode must never produce an executable action.")
  assert.equal(result.position, position, "The decision must expose the current immutable position projection.")
  assert.equal(Object.isFrozen(result), true, "The returned decision must be immutable.")
})
