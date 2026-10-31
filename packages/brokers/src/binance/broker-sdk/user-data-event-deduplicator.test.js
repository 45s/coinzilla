import assert from "node:assert/strict"
import test from "node:test"

import {
  createUserDataEventDeduplicator,
  getUserDataEventIdentity,
} from "./user-data-event-deduplicator.js"

test("execution reports use symbol, order ID, and execution ID as identity", () => {
  const deduplicator = createUserDataEventDeduplicator()
  const first = {
    subscriptionId: 4,
    event: { e: "executionReport", s: "BTCUSDT", i: 10, I: 21, X: "PARTIALLY_FILLED" },
  }

  assert.equal(deduplicator.isDuplicate(first), false)
  assert.equal(deduplicator.isDuplicate(structuredClone(first)), true)
  assert.equal(deduplicator.isDuplicate({
    ...first,
    event: { ...first.event, I: 22 },
  }), false)
  assert.equal(deduplicator.isDuplicate({
    ...first,
    event: { ...first.event, i: 11 },
  }), false)
  assert.equal(deduplicator.isDuplicate({
    ...first,
    subscriptionId: 5,
  }), false)
})

test("events without a stable unique ID use exact payload identity", () => {
  const deduplicator = createUserDataEventDeduplicator()
  const event = {
    subscriptionId: 3,
    event: { e: "balanceUpdate", a: "USDT", d: "2.50", T: 100, E: 101 },
  }

  assert.equal(deduplicator.isDuplicate(event), false)
  assert.equal(deduplicator.isDuplicate(structuredClone(event)), true)
  assert.equal(deduplicator.isDuplicate({
    ...event,
    event: { ...event.event, d: "3.50" },
  }), false)
})

test("the identity cache is bounded and evicts the oldest entry", () => {
  const deduplicator = createUserDataEventDeduplicator({ maxEntries: 2 })
  const event = (id) => ({
    subscriptionId: 1,
    event: { e: "balanceUpdate", a: "USDT", d: String(id), T: id, E: id },
  })

  assert.equal(deduplicator.isDuplicate(event(1)), false)
  assert.equal(deduplicator.isDuplicate(event(2)), false)
  assert.equal(deduplicator.isDuplicate(event(3)), false)
  assert.equal(deduplicator.size, 2)
  assert.equal(deduplicator.isDuplicate(event(1)), false)
})

test("invalid messages are not deduplicated and produce no identity", () => {
  const deduplicator = createUserDataEventDeduplicator()
  assert.equal(getUserDataEventIdentity(null), null)
  assert.equal(getUserDataEventIdentity({ event: [] }), null)
  assert.equal(deduplicator.isDuplicate(null), false)
  assert.equal(deduplicator.size, 0)
})

test("requires a positive integer cache bound", () => {
  assert.throws(() => createUserDataEventDeduplicator({ maxEntries: 0 }), RangeError)
  assert.throws(() => createUserDataEventDeduplicator({ maxEntries: 1.5 }), RangeError)
})
