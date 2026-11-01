import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"

import {
  installSignalHandlers,
  shutdownRuntime,
  startRuntime,
} from "../../src/bootstrap/startup.js"
import { createValidConfig } from "../helpers/config.js"

function createRuntime({
  journalStartResult = { ok: true },
  journalCloseResult = { ok: true },
  eventPublishResult = { ok: true },
  eventCloseResult = { ok: true },
} = {}) {
  const calls = []
  const runtime = {
    config: createValidConfig(),
    state: "created",
    shutdownPromise: null,
    logger: {
      info: (entry) => calls.push(["info", entry]),
      error: (entry) => calls.push(["error", entry]),
    },
    journal: {
      start: async () => {
        calls.push(["journal.start"])
        return journalStartResult
      },
      close: async () => {
        calls.push(["journal.close"])
        return journalCloseResult
      },
    },
    eventBus: {
      publish: (event) => {
        calls.push(["event.publish", event.name])
        return eventPublishResult
      },
      close: async () => {
        calls.push(["event.close"])
        return eventCloseResult
      },
    },
  }

  return { runtime, calls }
}

test("startRuntime starts the journal and publishes a no-trading event", async () => {
  const { runtime, calls } = createRuntime()

  await startRuntime(runtime)

  assert.equal(runtime.state, "started")
  assert.deepEqual(calls.map(([name]) => name), [
    "journal.start",
    "event.publish",
    "info",
  ])
  assert.equal(calls[1][1], "runtime.started")
})

test("startRuntime is idempotent after successful startup", async () => {
  const { runtime, calls } = createRuntime()

  await startRuntime(runtime)
  await startRuntime(runtime)

  assert.equal(calls.filter(([name]) => name === "journal.start").length, 1)
})

test("startRuntime closes resources when journal startup fails", async () => {
  const { runtime, calls } = createRuntime({
    journalStartResult: { ok: false, errors: [new Error("disk unavailable")] },
  })

  await assert.rejects(startRuntime(runtime), /journal startup failed/)
  assert.equal(runtime.state, "failed")
  assert.deepEqual(calls.map(([name]) => name), [
    "journal.start",
    "journal.close",
    "event.close",
  ])
})

test("shutdownRuntime is idempotent and closes journal before event bus", async () => {
  const { runtime, calls } = createRuntime()

  await startRuntime(runtime)
  const first = shutdownRuntime(runtime)
  const second = shutdownRuntime(runtime)

  assert.equal(first, second)
  await first

  assert.equal(runtime.state, "stopped")
  assert.deepEqual(
    calls.filter(([name]) => name === "journal.close" || name === "event.close")
      .map(([name]) => name),
    ["journal.close", "event.close"],
  )
})

test("shutdownRuntime reports cleanup failures after attempting both resources", async () => {
  const { runtime, calls } = createRuntime({
    journalCloseResult: { ok: false, errors: [new Error("journal failed")] },
  })

  await startRuntime(runtime)
  await assert.rejects(shutdownRuntime(runtime), AggregateError)

  assert.equal(runtime.state, "stopped")
  assert.ok(calls.some(([name]) => name === "event.close"))
})

test("installSignalHandlers shuts down once and removes both listeners", async () => {
  const { runtime, calls } = createRuntime()
  const processObject = new EventEmitter()
  processObject.exitCode = 0

  await startRuntime(runtime)
  installSignalHandlers({ runtime, processObject })

  processObject.emit("SIGTERM")
  processObject.emit("SIGINT")
  await shutdownRuntime(runtime)

  assert.equal(runtime.state, "stopped")
  assert.equal(processObject.listenerCount("SIGTERM"), 0)
  assert.equal(processObject.listenerCount("SIGINT"), 0)
  assert.equal(calls.filter(([name]) => name === "journal.close").length, 1)
})
