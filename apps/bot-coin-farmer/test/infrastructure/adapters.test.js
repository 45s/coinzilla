import test from "node:test"
import assert from "node:assert/strict"

import { EventBus } from "@coinzilla/event-bus"
import { Journal } from "@coinzilla/journal"

import { createEventBusAdapter } from "../../src/infrastructure/event-bus/event-bus-adapter.js"
import { createJournalAdapter } from "../../src/infrastructure/journal/journal-adapter.js"

test("createEventBusAdapter returns the shared EventBus implementation", () => {
  const eventBus = createEventBusAdapter()

  assert.ok(eventBus instanceof EventBus)
})

test("createJournalAdapter returns a Journal bound to the supplied bus", () => {
  const eventBus = createEventBusAdapter()
  const journal = createJournalAdapter({
    eventBus,
    directory: "/tmp/coin-farmer-test-journal",
  })

  assert.ok(journal instanceof Journal)
  assert.equal(journal.eventBus, eventBus)
})
