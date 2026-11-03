import test from "node:test"
import assert from "node:assert/strict"
import { EventBus } from "@coinzilla/event-bus"
import { makeEventPublisher } from "./event-publisher.js"

const validEvent = {
  name: "harvester.test",
  source: "harvester",
  data: { mode: "read-only" },
}

test("publishes an accepted event through the existing EventBus contract", () => {
  const publisher = makeEventPublisher({
    eventBus: new EventBus(),
    logger: { error() { assert.fail("successful publication must not be logged") } },
  })

  const result = publisher.publish(validEvent)

  assert.equal(result.ok, true)
  assert.equal(result.event.name, validEvent.name)
  assert.equal(result.event.source, validEvent.source)
  assert.deepEqual(result.event.data, validEvent.data)
})

test("contains a failed EventBus result and reports it once", () => {
  const error = new Error("delivery capacity exceeded")
  const logEntries = []
  const publisher = makeEventPublisher({
    eventBus: { publish: () => ({ ok: false, errors: [error] }) },
    logger: { error: (entry) => logEntries.push(entry) },
  })

  const result = publisher.publish(validEvent)

  assert.equal(result.ok, false)
  assert.deepEqual(result.errors, [error])
  assert.equal(logEntries.length, 1)
  assert.equal(logEntries[0].message, "Harvester event publication failed")
  assert.equal(logEntries[0].eventName, validEvent.name)
  assert.equal(logEntries[0].error, error)
})

test("contains a synchronous EventBus publication exception", () => {
  const error = new Error("publisher crashed")
  const logEntries = []
  const publisher = makeEventPublisher({
    eventBus: { publish: () => { throw error } },
    logger: { error: (entry) => logEntries.push(entry) },
  })

  const result = publisher.publish(validEvent)

  assert.equal(result.ok, false)
  assert.deepEqual(result.errors, [error])
  assert.equal(logEntries.length, 1)
  assert.equal(logEntries[0].error, error)
})

test("a logger exception cannot escape a failed publication", () => {
  const error = new Error("publisher crashed")
  const publisher = makeEventPublisher({
    eventBus: { publish: () => { throw error } },
    logger: { error: () => { throw new Error("logger crashed") } },
  })

  assert.doesNotThrow(() => {
    const result = publisher.publish(validEvent)
    assert.equal(result.ok, false)
    assert.deepEqual(result.errors, [error])
  })
})

test("invalid payloads are rejected by EventBus and reported without throwing", () => {
  const logEntries = []
  const publisher = makeEventPublisher({
    eventBus: new EventBus(),
    logger: { error: (entry) => logEntries.push(entry) },
  })

  const result = publisher.publish({
    ...validEvent,
    data: { unsupported: new Date() },
  })

  assert.equal(result.ok, false)
  assert.ok(result.errors[0] instanceof TypeError)
  assert.equal(logEntries.length, 1)
  assert.equal(logEntries[0].eventName, validEvent.name)
})

test("publication never waits for asynchronous subscriber work", async () => {
  const eventBus = new EventBus()
  let releaseHandler
  let handlerStarted = false
  const handlerGate = new Promise((resolve) => { releaseHandler = resolve })
  const subscription = eventBus.subscribe({
    name: validEvent.name,
    handler: async () => {
      handlerStarted = true
      await handlerGate
    },
  })
  assert.equal(subscription.ok, true)

  const publisher = makeEventPublisher({ eventBus, logger: { error() {} } })
  const result = publisher.publish(validEvent)

  assert.equal(result.ok, true)
  assert.equal(typeof result.then, "undefined")
  await Promise.resolve()
  assert.equal(handlerStarted, true)
  assert.equal(eventBus.getDiagnostics().pendingCount, 1)

  releaseHandler()
  await eventBus.flush()
  subscription.subscription.unsubscribe()
})
