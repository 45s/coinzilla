import nodeTest from "node:test"
import assert from "node:assert/strict"
import { StrategySafetyPauseIncompleteError } from "./strategy-safety-pause-incomplete-error.js"

const test = (...[name, ...args]) => nodeTest(
  `[strategy-safety-pause-incomplete-error.test.js] ${name}`,
  ...args,
)

test("preserves the market, original pause reason and unresolved cancellation counts", () => {
  const cause = new Error("owned BUY cancellation outcome is unknown")
  const error = new StrategySafetyPauseIncompleteError({
    symbol: "DOGEUSDT",
    reason: "STRATEGY_EVALUATION_FAILED",
    unresolvedOrderCount: 2,
    failureCount: 1,
    cause,
  })

  assert.equal(error.code, "STRATEGY_SAFETY_PAUSE_INCOMPLETE")
  assert.equal(error.context.symbol, "DOGEUSDT")
  assert.equal(error.context.reason, "STRATEGY_EVALUATION_FAILED")
  assert.equal(error.context.unresolvedOrderCount, 2)
  assert.equal(error.context.failureCount, 1)
  assert.equal(error.retryable, true)
  assert.equal(error.cause, cause)
})
