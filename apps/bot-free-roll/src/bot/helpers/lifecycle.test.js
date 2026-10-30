import test from "node:test"
import assert from "node:assert/strict"

import { createKeyedQueue, disconnectSubscriptions } from "./lifecycle.js"

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

test("reports a failed task and continues the same key queue", async () => {
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
  const second = queue.enqueue({
    key: "BTCUSDT",
    task: async () => {},
  })
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

test("disconnects supported subscription types and reports failures", async () => {
  const calls = []
  const result = await disconnectSubscriptions({
    subscriptions: [
      { disconnect: async () => { calls.push("disconnect") } },
      { close: async () => { calls.push("close") } },
      { unsubscribe: async () => { calls.push("unsubscribe") } },
      { disconnect: async () => { calls.push("failure"); throw new Error("disconnect failed") } },
      null,
      undefined,
    ],
  })

  assert.deepEqual(calls.sort(), ["close", "disconnect", "failure", "unsubscribe"].sort())
  assert.equal(result.results.length, 4)
  assert.deepEqual(result.results.map((entry) => entry.status).sort(), ["fulfilled", "fulfilled", "fulfilled", "rejected"].sort())
})
