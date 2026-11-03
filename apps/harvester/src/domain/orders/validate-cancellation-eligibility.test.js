import test from "node:test"
import assert from "node:assert/strict"
import { validateCancellationEligibility } from "./validate-cancellation-eligibility.js"

test("allows only broker-acknowledged open and partially-filled orders", () => {
  for (const status of ["OPEN", "PARTIALLY_FILLED"]) {
    const order = { status, brokerOrderId: "12345" }
    const result = validateCancellationEligibility({ order })
    assert.equal(result.ok, true)
    assert.equal(result.data.order, order)
  }
})

test("rejects pending, unknown, and terminal order states", () => {
  for (const status of ["PENDING", "UNKNOWN", "FILLED", "CANCELED", "REJECTED", "EXPIRED"]) {
    const result = validateCancellationEligibility({
      order: { status, brokerOrderId: "12345" },
    })
    assert.equal(result.ok, false, status)
    assert.match(result.errors[0].message, /not cancellable/)
  }
})

test("rejects missing or malformed broker acknowledgement IDs", () => {
  for (const brokerOrderId of [undefined, null, "", "   ", 123]) {
    const result = validateCancellationEligibility({
      order: { status: "OPEN", brokerOrderId },
    })
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /broker-acknowledged/)
  }
})

test("rejects missing and non-object inputs", () => {
  for (const order of [undefined, null, [], "order"]) {
    assert.equal(validateCancellationEligibility({ order }).ok, false)
  }
})
