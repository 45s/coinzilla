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

test("reports mapper errors without publishing invalid DTOs or when no publisher is injected", () => {
  let calls = 0
  const reportedFailures = []
  const mapperError = new Error("invalid event timestamp")
  const eventPublisher = {
    publish: () => { calls += 1; return { ok: true } },
    reportFailure: (failure) => reportedFailures.push(failure),
  }

  const result = publishLifecycleEvent({
    eventPublisher,
    eventName: "harvester.started",
    dataResult: { ok: false, errors: [mapperError] },
  })
  assert.equal(result.ok, false, "A failed DTO mapping must remain a failed publication result.")
  assert.equal(calls, 0, "EventBus must never receive a DTO that failed mapping.")
  assert.equal(reportedFailures.length, 1, "The event publisher must report the mapping failure even for best-effort callers.")
  assert.equal(reportedFailures[0].event.name, "harvester.started", "The diagnostic must identify the rejected event name.")
  assert.equal(reportedFailures[0].error, mapperError, "The diagnostic must preserve the original mapper error.")

  assert.equal(publishLifecycleEvent({
    eventName: "harvester.started",
    dataResult: { ok: true, data: {} },
  }).skipped, true, "A valid DTO without an injected publisher must remain an explicit skip.")
  assert.equal(calls, 0, "A skipped publication must not invoke EventBus.")
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
