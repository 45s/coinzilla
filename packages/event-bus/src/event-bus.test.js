import test from "node:test"
import assert from "node:assert/strict"

import { EventBus } from "../src/index.js"

function createTestBus({ onError } = {}) {
  const logs = []

  const bus = new EventBus({
    logger: {
      error: (message, context) => {
        logs.push({ message, context })
      },
    },
    onError,
  })

  return { bus, logs }
}

test("publishes a structured event", () => {
  const { bus } = createTestBus()

  const result = bus.publish({
    name: "order.filled",
    source: "binance",
    data: {
      symbol: "DOGEFDUSD",
      quantity: "100",
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.event.name, "order.filled")
  assert.equal(result.event.source, "binance")
  assert.equal(result.event.data.quantity, "100")
  assert.ok(result.event.id)
  assert.ok(Number.isFinite(Date.parse(result.event.timestamp)))

  bus.close()
})


test('publishes an "error" event safely when no consumer subscribes', async () => {
  const { bus } = createTestBus()

  const result = bus.publish({
    name: "error",
    source: "test",
    data: { message: "simulated error event" },
  })

  assert.equal(result.ok, true)
  assert.equal(result.event.name, "error")

  await bus.close()
})

test("returns a failure result for invalid events", () => {
  const { bus } = createTestBus()

  const result = bus.publish({
    name: "",
    source: "bot",
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0].message, /Event name/)

  bus.close()
})

test("delivers events to matching subscribers", async () => {
  const { bus } = createTestBus()
  let receivedEvent

  const result = bus.subscribe({
    name: "order.filled",
    handler: async (event) => {
      receivedEvent = event
    },
  })

  assert.equal(result.ok, true)

  const published = bus.publish({
    name: "order.filled",
    source: "binance",
    data: { orderId: "123" },
  })

  assert.equal(published.ok, true)

  await bus.flush()

  assert.equal(receivedEvent.id, published.event.id)
  assert.equal(receivedEvent.data.orderId, "123")

  await bus.close()
})

test("delivers every event to subscribeAll", async () => {
  const { bus } = createTestBus()
  const received = []

  bus.subscribeAll({
    handler: (event) => {
      received.push(event.name)
    },
  })

  bus.publish({ name: "bot.started", source: "bot" })
  bus.publish({ name: "ws.connected", source: "binance" })

  await bus.flush()

  assert.deepEqual(received, ["bot.started", "ws.connected"])

  await bus.close()
})

test("unsubscribe stops future delivery", async () => {
  const { bus } = createTestBus()
  let calls = 0

  const result = bus.subscribe({
    name: "bot.started",
    handler: () => {
      calls += 1
    },
  })

  assert.equal(result.ok, true)

  const { subscription } = result
  assert.equal(subscription.unsubscribe().ok, true)

  bus.publish({ name: "bot.started", source: "bot" })

  await bus.flush()

  assert.equal(calls, 0)
  assert.equal(subscription.unsubscribe().unsubscribed, false)

  await bus.close()
})

test("consumer failure is logged without blocking other consumers", async () => {
  const { bus, logs } = createTestBus()
  let secondConsumerCalled = false

  bus.subscribe({
    name: "order.filled",
    handler: () => {
      throw new Error("Consumer failed")
    },
  })

  bus.subscribe({
    name: "order.filled",
    handler: () => {
      secondConsumerCalled = true
    },
  })

  bus.publish({
    name: "order.filled",
    source: "binance",
  })

  await bus.flush()

  assert.equal(secondConsumerCalled, true)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].message, "Event consumer failed")
  assert.equal(logs[0].context.eventName, "order.filled")

  await bus.close()
})

test("supports asynchronous error handlers", async () => {
  const reportedErrors = []
  const { bus } = createTestBus({
    onError: async ({ error, eventName }) => {
      reportedErrors.push({ message: error.message, eventName })
    },
  })

  bus.subscribe({
    name: "bot.started",
    handler: async () => {
      throw new Error("Async consumer failed")
    },
  })

  bus.publish({ name: "bot.started", source: "bot" })

  await bus.flush()

  assert.deepEqual(reportedErrors, [
    {
      message: "Async consumer failed",
      eventName: "bot.started",
    },
  ])

  await bus.close()
})

test("flush waits for pending asynchronous handlers", async () => {
  const { bus } = createTestBus()
  let completed = false

  bus.subscribe({
    name: "bot.started",
    handler: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      completed = true
    },
  })

  bus.publish({ name: "bot.started", source: "bot" })

  const result = await bus.flush()

  assert.equal(result.ok, true)
  assert.equal(completed, true)

  await bus.close()
})

test("close waits for pending handlers and rejects new work", async () => {
  const { bus } = createTestBus()
  let completed = false

  bus.subscribe({
    name: "bot.started",
    handler: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      completed = true
    },
  })

  bus.publish({ name: "bot.started", source: "bot" })

  const result = await bus.close()

  assert.equal(result.ok, true)
  assert.equal(completed, true)

  assert.equal(bus.publish({ name: "bot.stopped", source: "bot" }).ok, false)

  assert.equal(
    bus.subscribe({
      name: "bot.stopped",
      handler: () => {},
    }).ok,
    false,
  )

  await bus.close()
})

test("rejects invalid event sources and data payloads", async () => {
  const { bus } = createTestBus()

  for (const source of [undefined, null, "", "   ", 123]) {
    const result = bus.publish({ name: "test.event", source })
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /Event source/)
  }

  for (const data of [null, [], "text", 123, true]) {
    const result = bus.publish({ name: "test.event", source: "test", data })
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /Event data/)
  }

  await bus.close()
})

test("rejects invalid subscription names and handlers", async () => {
  const { bus } = createTestBus()

  for (const name of [undefined, null, "", "   ", 123]) {
    const result = bus.subscribe({ name, handler: () => {} })
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /Event name/)
  }

  for (const handler of [undefined, null, "handler", {}]) {
    const result = bus.subscribe({ name: "test.event", handler })
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /Event handler/)
  }

  assert.equal(bus.subscribeAll({ handler: null }).ok, false)
  await bus.close()
})

test("published event envelopes are frozen and contain generated metadata", async () => {
  const { bus } = createTestBus()

  const result = bus.publish({
    name: "test.event",
    source: "unit-test",
    data: { count: 1 },
  })

  assert.equal(result.ok, true)
  assert.equal(Object.isFrozen(result.event), true)
  assert.match(result.event.id, /^[0-9a-f-]{36}$/i)
  assert.equal(typeof result.event.timestamp, "string")
  assert.equal(result.event.name, "test.event")
  assert.equal(result.event.source, "unit-test")
  assert.deepEqual(result.event.data, { count: 1 })

  await bus.close()
})

test("reports unsubscribe state consistently across repeated calls", async () => {
  const { bus } = createTestBus()
  const result = bus.subscribe({ name: "test.event", handler: () => {} })
  assert.equal(result.ok, true)
  assert.equal(result.subscription.unsubscribe().unsubscribed, true)
  assert.equal(result.subscription.unsubscribe().unsubscribed, false)
  await bus.close()
})


test("repeated close calls remain successful", async () => {
  const { bus } = createTestBus()
  const first = await bus.close()
  const second = await bus.close()
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(second.closed, true)
})

test("passes the original event and source to the error reporter", async () => {
  let reported
  const { bus } = createTestBus({
    onError: async (context) => { reported = context },
  })
  bus.subscribe({
    name: "trade.failed",
    handler: () => { throw new Error("handler failed") },
  })
  const published = bus.publish({
    name: "trade.failed",
    source: "test-source",
    data: { id: 7 },
  })
  await bus.flush()
  assert.equal(reported.error.message, "handler failed")
  assert.equal(reported.event.id, published.event.id)
  assert.equal(reported.eventName, "trade.failed")
  assert.equal(reported.event.source, "test-source")
  await bus.close()
})
