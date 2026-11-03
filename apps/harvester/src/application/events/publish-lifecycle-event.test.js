import test from "node:test"
import assert from "node:assert/strict"
import { publishLifecycleEvent } from "./publish-lifecycle-event.js"

test("publishes the mapped DTO synchronously with the Harvester source", () => {
  const events = []
  const result = publishLifecycleEvent({
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
    eventName: "harvester.started",
    dataResult: { ok: true, data: { mode: "read-only" } },
  })

  assert.deepEqual(result, { ok: true })
  assert.deepEqual(events, [{
    name: "harvester.started",
    source: "harvester",
    data: { mode: "read-only" },
  }])
})

test("does not publish invalid DTO mappings or when no publisher is injected", () => {
  let calls = 0
  const eventPublisher = { publish: () => { calls += 1; return { ok: true } } }

  assert.equal(publishLifecycleEvent({
    eventPublisher,
    eventName: "harvester.started",
    dataResult: { ok: false, errors: [new Error("invalid")] },
  }).ok, false)
  assert.equal(publishLifecycleEvent({
    eventName: "harvester.started",
    dataResult: { ok: true, data: {} },
  }).skipped, true)
  assert.equal(calls, 0)
})

test("contains a synchronous publisher exception", () => {
  const error = new Error("publisher failed")
  const result = publishLifecycleEvent({
    eventPublisher: { publish: () => { throw error } },
    eventName: "harvester.started",
    dataResult: { ok: true, data: {} },
  })
  assert.equal(result.ok, false)
  assert.equal(result.errors[0], error)
})
