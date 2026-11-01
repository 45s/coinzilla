import test from "node:test"
import assert from "node:assert/strict"

import { assertEventBusPort } from "../../src/ports/event-bus.js"
import { assertJournalPort } from "../../src/ports/journal.js"

test("assertEventBusPort accepts the shared EventBus contract", () => {
  const eventBus = {
    publish() {},
    subscribeAll() {},
    flush() {},
    close() {},
  }

  assert.equal(assertEventBusPort(eventBus), eventBus)
})

test("assertEventBusPort rejects missing capabilities", () => {
  assert.throws(
    () => assertEventBusPort({ publish() {} }),
    /must implement subscribeAll\(\)/,
  )
})

test("assertJournalPort accepts the lifecycle contract", () => {
  const journal = { start() {}, close() {} }
  assert.equal(assertJournalPort(journal), journal)
})

test("assertJournalPort rejects an incomplete journal", () => {
  assert.throws(
    () => assertJournalPort({ start() {} }),
    /must implement close\(\)/,
  )
})
