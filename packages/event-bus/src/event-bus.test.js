import test from "node:test"
import assert from "node:assert/strict"

import { EventBus } from "../src/index.js"

function createDeferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createTestBus({ onError } = {}) {
  const logs = []

  const bus = new EventBus({
    logger: {
      error: (entry) => {
        logs.push(entry)
      },
    },
    onError,
  })

  return { bus, logs }
}

test("validates constructor options and callbacks", async () => {
  for (const options of [null, [], "invalid", 123, new Date()]) {
    assert.throws(() => new EventBus(options), /EventBus options must be a plain object/)
  }

  assert.throws(() => new EventBus({ logger: null }), /logger must be an object/)
  assert.throws(() => new EventBus({ logger: { error: true } }), /optional error function/)
  assert.throws(() => new EventBus({ onError: "handler" }), /onError must be a function/)
  assert.throws(() => new EventBus({ onError: null }), /onError must be a function/)
  assert.throws(() => new EventBus({ loger: {} }), /Unknown EventBus option/)

  const bus = new EventBus({ logger: {}, onError: () => {} })
  assert.equal((await bus.close()).ok, true)
})

test("rejects malformed event names without normalizing valid names", async () => {
  const { bus } = createTestBus()
  const invalidNames = [
    "",
    " ",
    " leading",
    "trailing ",
    "contains space",
    "line\\nbreak",
    "name/slash",
    "name\\u0000control",
    "a".repeat(129),
    123,
    null,
    undefined,
  ]

  for (const name of invalidNames) {
    const published = bus.publish({ name, source: "test" })
    assert.equal(published.ok, false, String(name))
    assert.match(published.errors[0].message, /Event name/)
    const subscribed = bus.subscribe({ name, handler: () => {} })
    assert.equal(subscribed.ok, false, String(name))
    assert.match(subscribed.errors[0].message, /Event name/)
  }

  const exactName = "Trade.Fill_v2:partial"
  let received
  assert.equal(bus.subscribe({
    name: exactName,
    handler: event => { received = event.name },
  }).ok, true)
  const published = bus.publish({ name: exactName, source: "test" })
  assert.equal(published.ok, true)
  await bus.flush()
  assert.equal(received, exactName)
  await bus.close()
})

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
  assert.equal(logs[0].eventName, "order.filled")
  assert.equal(logs[0].source, "binance")
  assert.ok(logs[0].error instanceof Error)
  assert.match(logs[0].eventId, /^[0-9a-f-]{36}$/i)

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
  const started = createDeferred()
  const release = createDeferred()
  let completed = false

  bus.subscribe({
    name: "bot.started",
    handler: async () => {
      started.resolve()
      await release.promise
      completed = true
    },
  })

  bus.publish({ name: "bot.started", source: "bot" })
  await started.promise

  let flushCompleted = false
  const flushing = bus.flush().then((result) => {
    flushCompleted = true
    return result
  })

  await Promise.resolve()
  assert.equal(flushCompleted, false)
  assert.equal(completed, false)

  release.resolve()
  const result = await flushing

  assert.equal(result.ok, true)
  assert.equal(completed, true)

  await bus.close()
})

test("close waits for pending handlers and rejects new work", async () => {
  const { bus } = createTestBus()
  const started = createDeferred()
  const release = createDeferred()
  let completed = false

  bus.subscribe({
    name: "bot.started",
    handler: async () => {
      started.resolve()
      await release.promise
      completed = true
    },
  })

  bus.publish({ name: "bot.started", source: "bot" })
  await started.promise

  const closing = bus.close()
  assert.equal(bus.publish({ name: "bot.stopped", source: "bot" }).ok, false)
  assert.equal(
    bus.subscribe({
      name: "bot.stopped",
      handler: () => {},
    }).ok,
    false,
  )

  await Promise.resolve()
  assert.equal(completed, false)

  release.resolve()
  const result = await closing

  assert.equal(result.ok, true)
  assert.equal(completed, true)
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
  assert.equal(Object.isFrozen(result.event.data), true)

  await bus.close()
})

test("snapshots nested event data before asynchronous consumers run", async () => {
  const { bus } = createTestBus()
  const original = { order: { quantity: 1 } }
  let received

  bus.subscribe({
    name: "order.created",
    handler: (event) => {
      received = event.data
    },
  })

  const published = bus.publish({
    name: "order.created",
    source: "test",
    data: original,
  })

  original.order.quantity = 99
  original.order.extra = true

  await bus.flush()

  assert.equal(published.ok, true)
  assert.deepEqual(received, { order: { quantity: 1 } })
  assert.deepEqual(published.event.data, { order: { quantity: 1 } })
  assert.equal(Object.isFrozen(published.event.data.order), true)
  assert.throws(() => {
    published.event.data.order.quantity = 2
  }, TypeError)

  await bus.close()
})

test("rejects mutable built-ins and non-plain payload objects", async () => {
  const { bus } = createTestBus()
  class CustomPayload {
    constructor() {
      this.value = 1
    }
  }

  const unsupported = [
    new Date(),
    new Map([["key", "value"]]),
    new Set(["value"]),
    new Uint8Array([1, 2]),
    new ArrayBuffer(4),
    new DataView(new ArrayBuffer(4)),
    new CustomPayload(),
  ]

  for (const value of unsupported) {
    const result = bus.publish({
      name: "test.unsupported-payload",
      source: "unit-test",
      data: { value },
    })

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /plain objects, arrays, and primitive values/)
  }

  await bus.close()
})

test("rejects accessors without invoking them and rejects symbol properties", async () => {
  const { bus } = createTestBus()
  let getterCalls = 0
  const accessorPayload = {}

  Object.defineProperty(accessorPayload, "value", {
    enumerable: true,
    get() {
      getterCalls += 1
      return "unsafe"
    },
  })

  const accessorResult = bus.publish({
    name: "test.accessor-payload",
    source: "unit-test",
    data: accessorPayload,
  })

  assert.equal(accessorResult.ok, false)
  assert.match(accessorResult.errors[0].message, /accessor properties/)
  assert.equal(getterCalls, 0)

  const symbolPayload = { value: true }
  symbolPayload[Symbol("hidden")] = "not cloned"

  const symbolResult = bus.publish({
    name: "test.symbol-payload",
    source: "unit-test",
    data: symbolPayload,
  })

  assert.equal(symbolResult.ok, false)
  assert.match(symbolResult.errors[0].message, /symbol properties/)

  await bus.close()
})

test("preserves shared references while freezing supported payloads", async () => {
  const { bus } = createTestBus()
  const shared = { quantity: 1 }
  const result = bus.publish({
    name: "test.shared-reference",
    source: "unit-test",
    data: { first: shared, second: shared },
  })

  assert.equal(result.ok, true)
  assert.notEqual(result.event.data.first, shared)
  assert.equal(result.event.data.first, result.event.data.second)
  assert.equal(Object.isFrozen(result.event.data.first), true)
  assert.throws(() => {
    result.event.data.first.quantity = 2
  }, TypeError)

  await bus.close()
})

test("returns a failure result for functions in event data", async () => {
  const { bus } = createTestBus()
  const result = bus.publish({
    name: "test.event",
    source: "test",
    data: { callback() {} },
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /unsupported value/i)

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

test("defaults omitted event data to an empty object", async () => {
  const { bus } = createTestBus()
  const result = bus.publish({ name: "test.default-data", source: "unit-test" })
  assert.equal(result.ok, true)
  assert.deepEqual(result.event.data, {})
  await bus.close()
})

test("rejects subscriptions without a function handler", async () => {
  const { bus } = createTestBus()
  const result = bus.subscribe({ name: "test.event", handler: null })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /Event handler must be a function/)

  await bus.close()
})


test("flush also waits for events published by pending handlers", async () => {
  const { bus } = createTestBus()
  const received = []

  bus.subscribe({
    name: "workflow.started",
    handler: () => {
      received.push("started")
      const result = bus.publish({
        name: "workflow.completed",
        source: "event-handler",
      })
      assert.equal(result.ok, true)
    },
  })

  bus.subscribe({
    name: "workflow.completed",
    handler: async () => {
      await Promise.resolve()
      received.push("completed")
    },
  })

  const published = bus.publish({
    name: "workflow.started",
    source: "test",
  })
  assert.equal(published.ok, true)

  const flushed = await bus.flush()

  assert.equal(flushed.ok, true)
  assert.deepEqual(received, ["started", "completed"])

  await bus.close()
})

test("snapshots and freezes cyclic event data without recursion errors", async () => {
  const { bus } = createTestBus()
  const original = { name: "root" }
  original.self = original
  original.children = [{ parent: original }]

  const published = bus.publish({
    name: "graph.created",
    source: "test",
    data: original,
  })

  assert.equal(published.ok, true)
  assert.notEqual(published.event.data, original)
  assert.equal(published.event.data.self, published.event.data)
  assert.equal(
    published.event.data.children[0].parent,
    published.event.data,
  )
  assert.equal(Object.isFrozen(published.event.data), true)
  assert.equal(Object.isFrozen(published.event.data.children), true)
  assert.equal(Object.isFrozen(published.event.data.children[0]), true)

  assert.throws(() => {
    published.event.data.children[0].parent = null
  }, TypeError)

  await bus.close()
})


test("treats Node-special event names as ordinary application event names", async () => {
  const { bus } = createTestBus()
  const received = []

  for (const name of ["error", "newListener", "removeListener", "__proto__"]) {
    const subscribed = bus.subscribe({
      name,
      handler: (event) => received.push(event),
    })
    assert.equal(subscribed.ok, true)

    const published = bus.publish({
      name,
      source: "test",
      data: { expectedName: name },
    })
    assert.equal(published.ok, true)
  }

  await bus.flush()

  assert.deepEqual(received.map((event) => event.name), [
    "error",
    "newListener",
    "removeListener",
    "__proto__",
  ])
  assert.deepEqual(
    received.map((event) => event.data.expectedName),
    ["error", "newListener", "removeListener", "__proto__"],
  )

  await bus.close()
})

test("close invalidates outstanding subscription handles", async () => {
  const { bus } = createTestBus()
  const result = bus.subscribe({
    name: "test.close-subscription",
    handler: () => {},
  })

  assert.equal(result.ok, true)
  await bus.close()

  assert.equal(result.subscription.unsubscribe().unsubscribed, false)
  assert.equal(result.subscription.unsubscribe().unsubscribed, false)
})

test("rejects a publish atomically when its complete fan-out exceeds capacity", async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const received = []
  const bus = new EventBus({ maxPending: 2, logger: { error() {} } })

  bus.subscribe({
    name: "capacity.event",
    handler: async () => { received.push("named"); await gate },
  })
  bus.subscribeAll({
    handler: async () => { received.push("all"); await gate },
  })

  const accepted = bus.publish({ name: "capacity.event", source: "test" })
  assert.equal(accepted.ok, true)
  const rejected = bus.publish({ name: "capacity.event", source: "test" })
  assert.equal(rejected.ok, false)
  assert.match(rejected.errors[0].message, /pending delivery limit exceeded/)

  release()
  await bus.flush()
  assert.deepEqual(received, ["named", "all"])
  assert.equal(bus.publish({ name: "capacity.event", source: "test" }).ok, true)
  await bus.close()
})

test("rejects fan-out before invoking any named or subscribeAll consumer", async () => {
  const bus = new EventBus({ maxPending: 1, logger: { error() {} } })
  let calls = 0
  bus.subscribe({ name: "fanout.event", handler: () => { calls += 1 } })
  bus.subscribeAll({ handler: () => { calls += 1 } })

  const result = bus.publish({ name: "fanout.event", source: "test" })
  assert.equal(result.ok, false)
  await bus.flush()
  assert.equal(calls, 0)
  await bus.close()
})

test("accepts publishes without subscribers when no deliveries are scheduled", async () => {
  const bus = new EventBus({ maxPending: 1, logger: { error() {} } })
  assert.equal(bus.publish({ name: "unobserved.one", source: "test" }).ok, true)
  assert.equal(bus.publish({ name: "unobserved.two", source: "test" }).ok, true)
  await bus.close()
})

test("concurrent publishes cannot exceed the pending-delivery cap", async () => {
  const bus = new EventBus({ maxPending: 2, logger: { error() {} } })
  let release
  const gate = new Promise(resolve => { release = resolve })
  let calls = 0
  bus.subscribe({
    name: "concurrent.event",
    handler: async () => { calls += 1; await gate },
  })

  const results = [1, 2, 3].map(() =>
    bus.publish({ name: "concurrent.event", source: "test" }),
  )
  assert.deepEqual(results.map(result => result.ok), [true, true, false])
  release()
  await bus.flush()
  assert.equal(calls, 2)
  await bus.close()
})
