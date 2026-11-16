import test from "node:test"
import assert from "node:assert/strict"
import { describeProcessError } from "./describe-process-error.js"

test("describes an Error with its safe diagnostic fields and nested cause", () => {
  const cause = new TypeError("socket closed")
  const error = new Error("broker startup failed", { cause })
  error.code = "BROKER_CONNECTION_FAILED"
  error.symbol = "ZROUSDT"
  error.details = { retryable: true }

  const description = describeProcessError(error)

  assert.equal(description.name, "Error", "The concrete error name must be retained.")
  assert.equal(description.message, "broker startup failed", "The original error message must be retained.")
  assert.equal(description.code, "BROKER_CONNECTION_FAILED", "The stable error code must be retained.")
  assert.equal(description.symbol, "ZROUSDT", "The affected market must be retained.")
  assert.deepEqual(description.details, { retryable: true }, "Structured diagnostic details must be retained.")
  assert.equal(description.cause.name, "TypeError", "The nested cause type must be retained.")
  assert.equal(description.cause.message, "socket closed", "The nested cause message must be retained.")
  assert.match(description.stack, /broker startup failed/, "The stack must remain available for protected diagnostics.")
})

test("describes AggregateError members recursively", () => {
  const rootCause = new Error("journal flush failed")
  const aggregate = new AggregateError([rootCause], "startup cleanup failed")

  const description = describeProcessError(aggregate)

  assert.equal(description.name, "AggregateError", "Aggregate errors must retain their concrete type.")
  assert.equal(description.message, "startup cleanup failed", "Aggregate errors must retain their message.")
  assert.equal(description.errors.length, 1, "Every aggregate member must be represented.")
  assert.equal(description.errors[0].message, "journal flush failed", "Aggregate members must retain their messages.")
})

test("converts non-Error thrown values into a diagnostic message", () => {
  assert.deepEqual(
    describeProcessError("unexpected rejection"),
    { message: "unexpected rejection" },
    "Non-Error values must remain diagnosable without assuming Error properties.",
  )
})
