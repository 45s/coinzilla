import assert from "node:assert/strict"
import test from "node:test"

import { SystemCustomError } from "@coinzilla/utils"
import { BrokerUnsupportedOperationError } from "./broker-unsupported-operation-error.js"

test("BrokerUnsupportedOperationError has stable identity and safe operation context", () => {
  const cause = new Error("native provider limitation")
  const error = new BrokerUnsupportedOperationError({
    provider: "bitunix",
    operation: "createOrder",
    reason: "client order identity is unavailable",
    cause,
  })

  assert.ok(error instanceof Error)
  assert.ok(error instanceof SystemCustomError)
  assert.equal(error.name, "BrokerUnsupportedOperationError")
  assert.equal(error.code, "BROKER_OPERATION_UNSUPPORTED")
  assert.equal(error.retryable, false)
  assert.equal(error.cause, cause)
  assert.deepEqual(error.context, {
    provider: "bitunix",
    operation: "createOrder",
  })
  assert.match(error.message, /client order identity is unavailable/)
})

test("BrokerUnsupportedOperationError validates its operation identity", () => {
  for (const input of [
    {},
    {
      provider: "",
      operation: "createOrder",
      reason: "not supported",
    },
    {
      provider: "bitunix",
      operation: "",
      reason: "not supported",
    },
    {
      provider: "bitunix",
      operation: "createOrder",
      reason: "",
    },
  ]) {
    assert.throws(() => new BrokerUnsupportedOperationError(input), TypeError)
  }
})
