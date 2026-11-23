import assert from "node:assert/strict"
import test from "node:test"
import { SystemCustomError } from "@coinzilla/utils"
import { StrategySafetyPauseIncompleteError } from "./strategy-safety-pause-incomplete-error.js"

test("exposes a stable code and safe context while preserving the original cause", () => {
  const cause = new Error("owned BUY cancellation could not be confirmed")
  const error = new StrategySafetyPauseIncompleteError({
    symbol: "DOGEUSDT",
    reason: "STRATEGY_EVALUATION_FAILED",
    unresolvedOrderCount: 1,
    failureCount: 2,
    cause,
  })
  assert.ok(error instanceof SystemCustomError, "Strategy safety-pause failures must use the shared structured-error base.")
  assert.equal(error.name, "StrategySafetyPauseIncompleteError", "The error name must identify the owning Harvester use case.")
  assert.equal(error.code, "STRATEGY_SAFETY_PAUSE_INCOMPLETE", "The stable code must identify an incomplete strategy safety pause.")
  assert.equal(error.context.symbol, "DOGEUSDT", "The safe context must identify the affected market.")
  assert.equal(error.context.reason, "STRATEGY_EVALUATION_FAILED", "The safe context must preserve the pause trigger.")
  assert.equal(error.context.unresolvedOrderCount, 1, "The safe context must report unresolved owned BUY orders.")
  assert.equal(error.cause, cause, "The original cancellation failure must remain the native cause.")
  assert.equal(error.retryable, false, "An incomplete safety pause must not be treated as automatically retryable.")
})
