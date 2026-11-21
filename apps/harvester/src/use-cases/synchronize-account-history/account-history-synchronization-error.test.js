import assert from "node:assert/strict"
import test from "node:test"
import { AccountHistorySynchronizationError } from "./account-history-synchronization-error.js"

test("preserves all original market errors behind a stable operation error", () => {
  const orderFailure = new Error("order history unavailable")
  const tradeFailure = new Error("trade history unavailable")
  const error = new AccountHistorySynchronizationError({
    errors: [orderFailure, tradeFailure],
    marketCount: 4,
  })

  assert.ok(error instanceof Error, "The aggregate operation failure must remain an Error instance.")
  assert.equal(error.name, "AccountHistorySynchronizationError", "The aggregate error must expose its stable domain-specific name.")
  assert.equal(error.code, "HARVESTER_ACCOUNT_HISTORY_SYNC_FAILED", "The aggregate error must expose its stable machine-readable code.")
  assert.equal(error.message, "Account history synchronization failed for 2 of 4 configured markets", "The summary must report failed markets against the configured market count.")
  assert.deepEqual(error.context, {
    failureCount: 2,
    marketCount: 4,
  }, "The error context must preserve failed and configured market counts.")
  assert.ok(error.cause instanceof AggregateError, "The aggregate error must retain the original failures in an AggregateError cause.")
  assert.deepEqual(error.cause.errors, [orderFailure, tradeFailure], "The AggregateError must retain every original market failure in order.")
  assert.equal(error.cause.errors[0], orderFailure, "The first original error object must retain its identity.")
  assert.equal(error.cause.errors[1], tradeFailure, "The second original error object must retain its identity.")
})

test("rejects empty failures and invalid market counts", () => {
  assert.throws(
    () => new AccountHistorySynchronizationError({
      errors: [],
      marketCount: 1,
    }),
    /non-empty array/,
    "The aggregate error must reject an empty failure list.",
  )
  assert.throws(
    () => new AccountHistorySynchronizationError({
      errors: [new Error("failed")],
      marketCount: 0,
    }),
    /market count/,
    "The aggregate error must reject a non-positive configured market count.",
  )
  assert.throws(
    () => new AccountHistorySynchronizationError({
      errors: [new Error("first"), new Error("second")],
      marketCount: 1,
    }),
    /market count/,
    "The aggregate error must reject more failures than configured markets.",
  )
})
