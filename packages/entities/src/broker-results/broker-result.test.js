import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  BrokerResult,
  brokerResultErrMsgs,
  BROKER_RESULT_STATUSES,
} from "./broker-result.js"

describe(BrokerResult.name, () => {
  it("represents a complete successful result with data", () => {
    const data = { orderId: "order-1" }
    const result = new BrokerResult({ status: "SUCCESS", data })

    assert.equal(result.status, "SUCCESS")
    assert.equal(result.ok, true)
    assert.equal(result.hasData, true)
    assert.strictEqual(result.data, data)
    assert.deepEqual(result.errors, [])
  })

  it("supports successful operations without a data payload", () => {
    const result = new BrokerResult({ status: "SUCCESS" })

    assert.equal(result.ok, true)
    assert.equal(result.hasData, false)
    assert.equal(result.data, undefined)
  })

  it("represents a definitive failure with errors and no data", () => {
    const error = new Error("Order rejected")
    const result = new BrokerResult({ status: "FAILURE", errors: [error] })

    assert.equal(result.ok, false)
    assert.equal(result.hasData, false)
    assert.strictEqual(result.errors[0], error)
  })

  it("represents partial data and its errors as incomplete", () => {
    const data = [{ id: "fill-1" }]
    const error = new Error("History response was truncated")
    const result = new BrokerResult({
      status: "INCOMPLETE",
      data,
      errors: [error],
    })

    assert.equal(result.ok, false)
    assert.equal(result.hasData, true)
    assert.strictEqual(result.data, data)
    assert.strictEqual(result.errors[0], error)
  })

  it("represents an unresolved operation outcome without pretending it failed", () => {
    const error = new Error("Connection closed after request was sent")
    const result = new BrokerResult({ status: "UNKNOWN", errors: [error] })

    assert.equal(result.status, "UNKNOWN")
    assert.equal(result.ok, false)
    assert.equal(result.hasData, false)
    assert.strictEqual(result.errors[0], error)
  })

  it("exposes the stable result status vocabulary", () => {
    assert.deepEqual(BROKER_RESULT_STATUSES, [
      "SUCCESS",
      "FAILURE",
      "INCOMPLETE",
      "UNKNOWN",
    ])
  })

  it("rejects invalid input, status, and error collections", () => {
    for (const input of [null, "result", []]) {
      assert.throws(() => new BrokerResult(input), {
        message: brokerResultErrMsgs.input,
      })
    }
    assert.throws(() => new BrokerResult({ status: "MAYBE" }), {
      message: brokerResultErrMsgs.status,
    })
    for (const errors of [null, {}, "error", [undefined], [new Error(), "error"]]) {
      assert.throws(() => new BrokerResult({ status: "SUCCESS", errors }), {
        message: brokerResultErrMsgs.errors,
      })
    }
  })

  it("rejects errors on successful results", () => {
    assert.throws(
      () => new BrokerResult({ status: "SUCCESS", errors: [new Error("unexpected")] }),
      { message: brokerResultErrMsgs.successErrors },
    )
  })

  it("requires errors for definitive failures and unresolved outcomes", () => {
    assert.throws(() => new BrokerResult({ status: "FAILURE" }), {
      message: brokerResultErrMsgs.failureErrors,
    })
    assert.throws(() => new BrokerResult({ status: "UNKNOWN" }), {
      message: brokerResultErrMsgs.unknownErrors,
    })
  })

  it("rejects data on definitive failures and unknown outcomes", () => {
    assert.throws(
      () => new BrokerResult({ status: "FAILURE", data: {}, errors: [new Error()] }),
      { message: brokerResultErrMsgs.failureData },
    )
    assert.throws(
      () => new BrokerResult({ status: "UNKNOWN", data: {}, errors: [new Error()] }),
      { message: brokerResultErrMsgs.unknownData },
    )
  })

  it("requires both partial data and errors for incomplete results", () => {
    assert.throws(
      () => new BrokerResult({ status: "INCOMPLETE", errors: [new Error()] }),
      { message: brokerResultErrMsgs.incompleteData },
    )
    assert.throws(
      () => new BrokerResult({ status: "INCOMPLETE", data: [] }),
      { message: brokerResultErrMsgs.incompleteErrors },
    )
  })

  it("returns an immutable error collection without mutating caller data", () => {
    const errors = [new Error("first")]
    const result = new BrokerResult({ status: "FAILURE", errors })

    errors.push(new Error("second"))

    assert.equal(result.errors.length, 1)
    assert.throws(() => {
      result.errors.push(new Error("third"))
    }, TypeError)
    assert.throws(() => {
      result.status = "SUCCESS"
    }, TypeError)
  })
})
