import test from "node:test"
import assert from "node:assert/strict"

import { canAcceptDeliveries } from "./delivery-capacity.js"

test("accepts a fan-out that fits exactly within the limit", () => {
  assert.equal(canAcceptDeliveries({ pendingCount: 2, deliveryCount: 3, maxPending: 5 }), true)
})

test("rejects a fan-out that would exceed the limit", () => {
  assert.equal(canAcceptDeliveries({ pendingCount: 2, deliveryCount: 4, maxPending: 5 }), false)
})

test("accepts zero deliveries when pending work is at capacity", () => {
  assert.equal(canAcceptDeliveries({ pendingCount: 5, deliveryCount: 0, maxPending: 5 }), true)
})

test("rejects when pending work is already above the limit", () => {
  assert.equal(canAcceptDeliveries({ pendingCount: 6, deliveryCount: 0, maxPending: 5 }), false)
})
