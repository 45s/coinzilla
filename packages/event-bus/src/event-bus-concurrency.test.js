import test from "node:test"
import assert from "node:assert/strict"

import { EventBus } from "./index.js"

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test("accepted deliveries may overlap and complete out of publish order", async () => {
  const bus = new EventBus({ logger: {} })
  const firstGate = deferred()
  const secondGate = deferred()
  const bothStarted = deferred()
  const started = []
  const completed = []

  bus.subscribe({
    name: "work.started",
    handler: async (event) => {
      started.push(event.data.id)
      if (started.length === 2) bothStarted.resolve()
      await (event.data.id === 1 ? firstGate.promise : secondGate.promise)
      completed.push(event.data.id)
    },
  })

  assert.equal(bus.publish({
    name: "work.started",
    source: "test",
    data: { id: 1 },
  }).ok, true)
  assert.equal(bus.publish({
    name: "work.started",
    source: "test",
    data: { id: 2 },
  }).ok, true)

  await bothStarted.promise
  assert.deepEqual(started, [1, 2])

  secondGate.resolve()
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(completed, [2])

  firstGate.resolve()
  assert.equal((await bus.flush()).ok, true)
  assert.deepEqual(completed, [2, 1])
  assert.equal((await bus.close()).ok, true)
})

test("unsubscribe does not cancel an already accepted delivery", async () => {
  const bus = new EventBus({ logger: {} })
  const started = deferred()
  const release = deferred()
  let calls = 0

  const result = bus.subscribe({
    name: "work.started",
    handler: async () => {
      calls += 1
      started.resolve()
      await release.promise
    },
  })

  assert.equal(result.ok, true)
  assert.equal(bus.publish({ name: "work.started", source: "test" }).ok, true)
  await started.promise

  assert.equal(result.subscription.unsubscribe().unsubscribed, true)
  assert.equal(bus.publish({ name: "work.started", source: "test" }).ok, true)

  release.resolve()
  assert.equal((await bus.flush()).ok, true)
  assert.equal(calls, 1)
  assert.equal((await bus.close()).ok, true)
})

test("matching subscribers start independently for one accepted event", async () => {
  const bus = new EventBus({ logger: {} })
  const release = deferred()
  const bothStarted = deferred()
  const started = []

  for (const subscriber of ["first", "second"]) {
    bus.subscribe({
      name: "work.started",
      handler: async () => {
        started.push(subscriber)
        if (started.length === 2) bothStarted.resolve()
        await release.promise
      },
    })
  }

  assert.equal(bus.publish({ name: "work.started", source: "test" }).ok, true)
  await bothStarted.promise
  assert.deepEqual(started, ["first", "second"])

  release.resolve()
  assert.equal((await bus.flush()).ok, true)
  assert.equal((await bus.close()).ok, true)
})

test("flush waits for nested publishes made after an async handler resumes", async () => {
  const bus = new EventBus({ logger: {} })
  const started = deferred()
  const continueHandler = deferred()
  let nestedPublish
  let nestedCompleted = false

  bus.subscribe({
    name: "workflow.started",
    handler: async () => {
      started.resolve()
      await continueHandler.promise
      nestedPublish = bus.publish({
        name: "workflow.completed",
        source: "event-handler",
      })
    },
  })
  bus.subscribe({
    name: "workflow.completed",
    handler: async () => {
      await Promise.resolve()
      nestedCompleted = true
    },
  })

  assert.equal(bus.publish({ name: "workflow.started", source: "test" }).ok, true)
  await started.promise

  const flushing = bus.flush()
  continueHandler.resolve()
  assert.equal((await flushing).ok, true)
  assert.equal(nestedPublish.ok, true)
  assert.equal(nestedCompleted, true)
  assert.equal((await bus.close()).ok, true)
})
