import assert from "node:assert/strict"
import test from "node:test"

import { createKeyedQueue } from "./keyed-queue.js"

test("serializes tasks for the same key in enqueue order", async () => {
  const queue = createKeyedQueue()
  const order = []
  let releaseFirst
  const firstGate = new Promise((resolve) => { releaseFirst = resolve })

  const first = queue.enqueue({
    key: "DOGEUSDT",
    task: async () => {
      order.push("first:start")
      await firstGate
      order.push("first:end")
    },
  })
  const second = queue.enqueue({
    key: "DOGEUSDT",
    task: async () => { order.push("second") },
  })

  await Promise.resolve()
  assert.deepEqual(order, ["first:start"])

  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(order, ["first:start", "first:end", "second"])
})

test("runs tasks for different keys independently", async () => {
  const queue = createKeyedQueue()
  let releaseFirst
  const firstGate = new Promise((resolve) => { releaseFirst = resolve })
  let secondStarted = false

  const first = queue.enqueue({ key: "DOGEUSDT", task: () => firstGate })
  const second = queue.enqueue({
    key: "BTCUSDT",
    task: async () => { secondStarted = true },
  })

  await second
  assert.equal(secondStarted, true)
  releaseFirst()
  await first
})

test("reports task failures and continues the same key queue", async () => {
  const errors = []
  const queue = createKeyedQueue({ onError: (entry) => errors.push(entry) })
  const order = []
  const failure = new Error("simulated failure")

  await queue.enqueue({ key: "DOGEUSDT", task: async () => { throw failure } })
  await queue.enqueue({ key: "DOGEUSDT", task: async () => { order.push("continued") } })

  assert.equal(errors.length, 1)
  assert.equal(errors[0].key, "DOGEUSDT")
  assert.equal(errors[0].error, failure)
  assert.deepEqual(order, ["continued"])
})

test("propagates task failures when no error handler is configured and continues", async () => {
  const queue = createKeyedQueue()
  const order = []

  await assert.rejects(
    queue.enqueue({ key: "same", task: async () => { throw new Error("task failed") } }),
    /task failed/,
  )
  await queue.enqueue({ key: "same", task: async () => { order.push("next") } })
  await queue.drain()

  assert.deepEqual(order, ["next"])
})

test("a failing error handler does not poison later tasks", async () => {
  const queue = createKeyedQueue({
    onError() { throw new Error("reporting failed") },
  })
  const order = []

  await assert.rejects(
    queue.enqueue({ key: "same", task: async () => { throw new Error("task failed") } }),
    /reporting failed/,
  )
  await queue.enqueue({ key: "same", task: async () => { order.push("next") } })
  await queue.drain()

  assert.deepEqual(order, ["next"])
})

test("drain waits for pending tasks across all keys", async () => {
  const queue = createKeyedQueue()
  let releaseTask
  const taskGate = new Promise((resolve) => { releaseTask = resolve })
  let taskFinished = false
  let drainFinished = false

  const first = queue.enqueue({
    key: "DOGEUSDT",
    task: async () => {
      await taskGate
      taskFinished = true
    },
  })
  const second = queue.enqueue({ key: "BTCUSDT", task: async () => {} })
  const drain = queue.drain().then(() => { drainFinished = true })

  await second
  await Promise.resolve()
  assert.equal(taskFinished, false)
  assert.equal(drainFinished, false)

  releaseTask()
  await Promise.all([first, drain])
  assert.equal(taskFinished, true)
  assert.equal(drainFinished, true)
})

test("validates queue options and enqueue input", () => {
  assert.throws(() => createKeyedQueue(null), /options/)
  assert.throws(() => createKeyedQueue([]), /options/)
  assert.throws(() => createKeyedQueue({ onError: true }), /onError/)
  const queue = createKeyedQueue()
  assert.throws(() => queue.enqueue({ task() {} }), /key/)
  assert.throws(() => queue.enqueue({ key: "x", task: true }), /task/)
  assert.equal(Object.isFrozen(queue), true)
})
