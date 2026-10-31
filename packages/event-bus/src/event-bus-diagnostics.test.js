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

test("diagnostics expose immutable snapshots of pending capacity and lifecycle", async () => {
  const bus = new EventBus({ logger: {}, maxPending: 2 })
  const release = deferred()
  const started = deferred()

  assert.deepEqual(bus.getDiagnostics(), {
    pendingCount: 0,
    maxPending: 2,
    closed: false,
  })

  bus.subscribe({
    name: "task.started",
    handler: async () => {
      started.resolve()
      await release.promise
    },
  })

  assert.equal(bus.publish({ name: "task.started", source: "test" }).ok, true)
  await started.promise

  const pending = bus.getDiagnostics()
  assert.deepEqual(pending, {
    pendingCount: 1,
    maxPending: 2,
    closed: false,
  })
  assert.equal(Object.isFrozen(pending), true)
  assert.throws(() => {
    pending.pendingCount = 100
  }, TypeError)
  assert.equal(bus.getDiagnostics().pendingCount, 1)

  release.resolve()
  assert.equal((await bus.flush()).ok, true)
  assert.equal(bus.getDiagnostics().pendingCount, 0)
  assert.equal((await bus.close()).ok, true)
  assert.deepEqual(bus.getDiagnostics(), {
    pendingCount: 0,
    maxPending: 2,
    closed: true,
  })
})

test("close timeout leaves the bus closed and allows a later drain", async () => {
  const bus = new EventBus({ logger: {} })
  const started = deferred()
  const release = deferred()

  const subscriptionResult = bus.subscribe({
    name: "task.started",
    handler: async () => {
      started.resolve()
      await release.promise
    },
  })

  assert.equal(bus.publish({ name: "task.started", source: "test" }).ok, true)
  await started.promise

  const timedOut = await bus.close({ timeoutMs: 10 })
  assert.equal(timedOut.ok, false)
  assert.equal(timedOut.timedOut, true)
  assert.match(timedOut.errors[0].message, /timed out after 10ms/)
  assert.deepEqual(bus.getDiagnostics(), {
    pendingCount: 1,
    maxPending: 1000,
    closed: true,
  })
  assert.equal(bus.publish({ name: "task.started", source: "test" }).ok, false)
  assert.equal(subscriptionResult.subscription.unsubscribe().unsubscribed, false)

  release.resolve()
  assert.equal((await bus.close()).ok, true)
  assert.equal(bus.getDiagnostics().pendingCount, 0)
})

test("close validates timeout options without closing the bus", async () => {
  const bus = new EventBus({ logger: {} })

  for (const options of [null, [], { timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: 1.5 }, { timeoutMs: Number.MAX_SAFE_INTEGER + 1 }, { unknown: true }]) {
    const result = await bus.close(options)
    assert.equal(result.ok, false)
  }

  assert.equal(bus.getDiagnostics().closed, false)
  assert.equal((await bus.close()).ok, true)
})

test("concurrent close callers both observe a completed drain", async () => {
  const bus = new EventBus({ logger: {} })
  const started = deferred()
  const release = deferred()

  bus.subscribe({
    name: "task.started",
    handler: async () => {
      started.resolve()
      await release.promise
    },
  })
  assert.equal(bus.publish({ name: "task.started", source: "test" }).ok, true)
  await started.promise

  const firstClose = bus.close()
  const secondClose = bus.close()
  release.resolve()

  const [first, second] = await Promise.all([firstClose, secondClose])
  assert.equal(first.ok, true)
  assert.equal(first.closed, true)
  assert.equal(second.ok, true)
  assert.equal(second.closed, true)
  assert.deepEqual(bus.getDiagnostics(), {
    pendingCount: 0,
    maxPending: 1000,
    closed: true,
  })
})
