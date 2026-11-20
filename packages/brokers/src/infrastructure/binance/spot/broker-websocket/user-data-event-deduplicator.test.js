import assert from "node:assert/strict"
import test from "node:test"
import { createUserDataEventDeduplicator } from "./user-data-event-deduplicator.js"

test("deduplicates identical execution reports across subscriptions", () => {
  const deduplicator = createUserDataEventDeduplicator()
  const report = {
    subscriptionId: 4,
event: { e: "executionReport",
s: "BTCUSDT",
i: 10,
I: 21 },
  }
  assert.equal(deduplicator.isDuplicate(report), false)
  assert.equal(deduplicator.isDuplicate(structuredClone(report)), true)
  assert.equal(deduplicator.isDuplicate({ ...report, subscriptionId: 5 }), true)
  assert.equal(deduplicator.isDuplicate({
    ...report,
event: { ...report.event,
I: 22 },
  }), false)
  assert.equal(deduplicator.size, 2)
})

test("uses exact payload identity and evicts the oldest cache entry", () => {
  const deduplicator = createUserDataEventDeduplicator({ maxEntries: 2 })
  const event = (id) => ({
    subscriptionId: 1,
event: { e: "balanceUpdate",
a: "USDT",
d: String(id),
T: id,
E: id },
  })
  assert.equal(deduplicator.isDuplicate(event(1)), false)
  assert.equal(deduplicator.isDuplicate(event(2)), false)
  assert.equal(deduplicator.isDuplicate(event(3)), false)
  assert.equal(deduplicator.size, 2)
  assert.equal(deduplicator.isDuplicate(event(1)), false)
})

test("clear resets the bounded cache and invalid messages are ignored", () => {
  const deduplicator = createUserDataEventDeduplicator()
  assert.equal(deduplicator.isDuplicate(null), false)
  assert.equal(deduplicator.size, 0)
  const event = { e: "balanceUpdate",
a: "USDT",
d: "1",
T: 1,
E: 1 }
  assert.equal(deduplicator.isDuplicate(event), false)
  deduplicator.clear()
  assert.equal(deduplicator.size, 0)
  assert.equal(deduplicator.isDuplicate(event), false)
})

test("requires a positive integer cache bound", () => {
  assert.throws(() => createUserDataEventDeduplicator({ maxEntries: 0 }), RangeError)
  assert.throws(() => createUserDataEventDeduplicator({ maxEntries: 1.5 }), RangeError)
})
