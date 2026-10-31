import test from "node:test"
import assert from "node:assert/strict"
import { EventBus } from "../../../event-bus/src/event-bus.js"
import {
  subscribeTelegramNotifications,
  TELEGRAM_NOTIFICATION_EVENTS,
} from "./telegram-event-subscriber.js"

function createEventBus({ failAt, throwOnUnsubscribe = [] } = {}) {
  const handlers = new Map()
  const unsubscribed = []
  return {
    handlers,
    unsubscribed,
    subscribe({ name, handler }) {
      if (name === failAt) return { ok: false }
      handlers.set(name, handler)
      return {
        ok: true,
        subscription: {
          unsubscribe() {
            unsubscribed.push(name)
            if (throwOnUnsubscribe.includes(name)) {
              throw new Error(`unsubscribe failed: ${name}`)
            }
            return { ok: true, unsubscribed: true }
          },
        },
      }
    },
  }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test("subscribes only to the explicit allowlist and delivers events", async () => {
  const eventBus = createEventBus()
  const messages = []
  const subscriber = subscribeTelegramNotifications({
    eventBus,
    notifier: { async sendMessage(message) { messages.push(message) } },
  })

  assert.deepEqual([...eventBus.handlers.keys()], [...TELEGRAM_NOTIFICATION_EVENTS])
  await eventBus.handlers.get("order.filled")({
    name: "order.filled",
    data: { symbol: "BTCUSDT" },
  })
  assert.match(messages[0], /ORDER FILLED/)

  await subscriber.close()
  await subscriber.close()
  assert.equal(eventBus.unsubscribed.length, TELEGRAM_NOTIFICATION_EVENTS.length)
})

test("serializes accepted sends and drains them on close", async () => {
  const eventBus = createEventBus()
  const sent = []
  const gate = deferred()
  const subscriber = subscribeTelegramNotifications({
    eventBus,
    notifier: {
      async sendMessage(message) {
        sent.push(message)
        if (sent.length === 1) await gate.promise
      },
    },
  })

  const firstDelivery = eventBus.handlers.get("bot.started")({
    name: "bot.started",
    data: {},
  })
  const secondDelivery = eventBus.handlers.get("bot.stopped")({
    name: "bot.stopped",
    data: {},
  })

  await Promise.resolve()
  assert.equal(sent.length, 1)

  let closed = false
  const closing = subscriber.close().then(() => { closed = true })
  await Promise.resolve()
  assert.equal(closed, false)

  gate.resolve()
  await Promise.all([firstDelivery, secondDelivery, closing])
  assert.equal(sent.length, 2)
  assert.equal(closed, true)
})

test("ignores callbacks that were scheduled before unsubscribe but start after close", async () => {
  const eventBus = createEventBus()
  const sent = []
  const subscriber = subscribeTelegramNotifications({
    eventBus,
    notifier: { async sendMessage(message) { sent.push(message) } },
  })
  const scheduledHandler = eventBus.handlers.get("bot.started")

  await subscriber.close()
  await scheduledHandler({ name: "bot.started", data: {} })

  assert.deepEqual(sent, [])
})

test("bounds queued work and reports capacity overflow without blocking later events", async () => {
  const eventBus = createEventBus()
  const gate = deferred()
  const errors = []
  const sent = []
  const subscriber = subscribeTelegramNotifications({
    eventBus,
    maxPending: 1,
    logger: { error(entry) { errors.push(entry) } },
    notifier: {
      async sendMessage(message) {
        sent.push(message)
        await gate.promise
      },
    },
  })

  const first = eventBus.handlers.get("bot.started")({
    name: "bot.started",
    data: {},
  })
  await Promise.resolve()

  await eventBus.handlers.get("bot.stopped")({
    name: "bot.stopped",
    data: {},
  })

  assert.equal(sent.length, 1)
  assert.equal(errors.length, 1)
  assert.match(errors[0].error.message, /queue capacity exceeded/)

  gate.resolve()
  await first
  await subscriber.close()
})

test("rejects invalid maxPending configuration", () => {
  for (const maxPending of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => subscribeTelegramNotifications({
        eventBus: createEventBus(),
        notifier: { sendMessage() {} },
        maxPending,
      }),
      /maxPending/,
    )
  }
})

test("reports delivery failures once and continues processing later events", async () => {
  const eventBus = createEventBus()
  const errors = []
  let calls = 0
  const subscriber = subscribeTelegramNotifications({
    eventBus,
    notifier: {
      async sendMessage() {
        calls += 1
        if (calls === 1) throw new Error("network down")
      },
    },
    logger: { error(entry) { errors.push(entry) } },
  })

  await eventBus.handlers.get("bot.started")({ name: "bot.started", data: {} })
  await eventBus.handlers.get("bot.stopped")({ name: "bot.stopped", data: {} })

  assert.equal(errors.length, 1)
  assert.equal(calls, 2)
  assert.equal(errors[0].eventName, "bot.started")
  await subscriber.close()
})

test("leaves failures observable to the event bus when no logger is configured", async () => {
  const eventBus = createEventBus()
  let calls = 0
  const subscriber = subscribeTelegramNotifications({
    eventBus,
    notifier: {
      async sendMessage() {
        calls += 1
        if (calls === 1) throw new Error("no logger path")
      },
    },
  })

  await assert.rejects(
    eventBus.handlers.get("bot.started")({ name: "bot.started", data: {} }),
    /no logger path/,
  )
  await eventBus.handlers.get("bot.stopped")({ name: "bot.stopped", data: {} })
  assert.equal(calls, 2)
  await subscriber.close()
})

test("unsubscribes partial registrations when setup fails", () => {
  const eventBus = createEventBus({
    failAt: TELEGRAM_NOTIFICATION_EVENTS[2],
  })
  assert.throws(
    () => subscribeTelegramNotifications({
      eventBus,
      notifier: { sendMessage() {} },
    }),
    /Unable to subscribe/,
  )
  assert.equal(eventBus.unsubscribed.length, 2)
})

test("attempts every cleanup after setup failure and preserves the setup error", () => {
  const eventBus = createEventBus({
    failAt: TELEGRAM_NOTIFICATION_EVENTS[2],
    throwOnUnsubscribe: [TELEGRAM_NOTIFICATION_EVENTS[0]],
  })

  assert.throws(
    () => subscribeTelegramNotifications({
      eventBus,
      notifier: { sendMessage() {} },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError)
      assert.match(error.message, /cleanup was incomplete/)
      assert.match(error.cause.message, /Unable to subscribe/)
      return true
    },
  )
  assert.deepEqual(
    eventBus.unsubscribed,
    TELEGRAM_NOTIFICATION_EVENTS.slice(0, 2),
  )
})

test("rejects malformed subscription handles and cleans up prior handles", () => {
  const eventBus = createEventBus()
  const originalSubscribe = eventBus.subscribe
  eventBus.subscribe = (options) => {
    if (options.name === TELEGRAM_NOTIFICATION_EVENTS[1]) {
      return { ok: true, subscription: {} }
    }
    return originalSubscribe(options)
  }

  assert.throws(
    () => subscribeTelegramNotifications({
      eventBus,
      notifier: { sendMessage() {} },
    }),
    /Unable to subscribe/,
  )
  assert.equal(eventBus.unsubscribed.length, 1)
})

test("close is idempotent and reports cleanup failures after attempting every unsubscribe", async () => {
  const eventBus = createEventBus({
    throwOnUnsubscribe: [TELEGRAM_NOTIFICATION_EVENTS[0]],
  })
  const subscriber = subscribeTelegramNotifications({
    eventBus,
    notifier: { async sendMessage() {} },
  })

  const firstClose = subscriber.close()
  const secondClose = subscriber.close()
  assert.equal(firstClose, secondClose)

  await assert.rejects(firstClose, (error) => {
    assert.ok(error instanceof AggregateError)
    assert.match(error.message, /Unable to clean up every/)
    return true
  })
  assert.equal(eventBus.unsubscribed.length, TELEGRAM_NOTIFICATION_EVENTS.length)
})

test("validates dependencies and does not let logger failures poison later sends", async () => {
  assert.throws(() => subscribeTelegramNotifications({}), /eventBus/)
  assert.throws(
    () => subscribeTelegramNotifications({ eventBus: {} }),
    /eventBus/,
  )
  assert.throws(
    () => subscribeTelegramNotifications({ eventBus: createEventBus() }),
    /notifier/,
  )
  assert.throws(
    () => subscribeTelegramNotifications({
      eventBus: createEventBus(),
      notifier: { sendMessage() {} },
      logger: { error: true },
    }),
    /logger.error/,
  )

  const warnings = []
  const originalEmitWarning = process.emitWarning
  process.emitWarning = (message) => warnings.push(message)

  try {
    const eventBus = createEventBus()
    let calls = 0
    const subscriber = subscribeTelegramNotifications({
      eventBus,
      notifier: {
        async sendMessage() {
          calls += 1
          throw new Error("send failed")
        },
      },
      logger: { error() { throw new Error("log failed") } },
    })

    await assert.rejects(
      eventBus.handlers.get("bot.started")({ name: "bot.started", data: {} }),
      /send failed/,
    )
    await assert.rejects(
      eventBus.handlers.get("bot.stopped")({ name: "bot.stopped", data: {} }),
      /send failed/,
    )

    assert.equal(calls, 2)
    assert.equal(warnings.length, 2)
    await subscriber.close()
  } finally {
    process.emitWarning = originalEmitWarning
  }
})


test("exposes immutable delivery diagnostics for success, failure, overflow, and close", async () => {
  const eventBus = createEventBus()
  const gate = deferred()
  const errors = []
  const subscriber = subscribeTelegramNotifications({
    eventBus,
    maxPending: 1,
    logger: { error(entry) { errors.push(entry) } },
    notifier: {
      async sendMessage() {
        await gate.promise
        throw new Error("Telegram unavailable")
      },
    },
  })

  const first = eventBus.handlers.get("bot.started")({
    name: "bot.started",
    data: {},
  })
  await Promise.resolve()
  await eventBus.handlers.get("bot.stopped")({
    name: "bot.stopped",
    data: {},
  })

  const queued = subscriber.getDiagnostics()
  assert.deepEqual(queued, {
    acceptedCount: 1,
    deliveredCount: 0,
    failedCount: 0,
    overflowCount: 1,
    pendingCount: 1,
    closed: false,
  })
  assert.equal(Object.isFrozen(queued), true)
  assert.equal(errors.length, 1)

  gate.resolve()
  await first
  const settled = subscriber.getDiagnostics()
  assert.equal(settled.failedCount, 1)
  assert.equal(settled.deliveredCount, 0)
  assert.equal(settled.pendingCount, 0)

  await subscriber.close()
  assert.equal(subscriber.getDiagnostics().closed, true)
})

test("integrates with the real EventBus for allowlisting, ordering, flush, and close", async () => {
  const eventBusErrors = []
  const eventBus = new EventBus({
    logger: { error(entry) { eventBusErrors.push(entry) } },
  })
  const sent = []
  const subscriber = subscribeTelegramNotifications({
    eventBus,
    notifier: { async sendMessage(message) { sent.push(message) } },
  })

  assert.equal(eventBus.publish({
    name: "bot.started",
    source: "integration-test",
  }).ok, true)
  assert.equal(eventBus.publish({
    name: "order.filled",
    source: "integration-test",
    data: { symbol: "BTCUSDT", side: "BUY", price: "100", quantity: "1" },
  }).ok, true)
  assert.equal(eventBus.publish({
    name: "order.execution_report",
    source: "integration-test",
    data: { raw: "must not be sent" },
  }).ok, true)

  assert.equal((await eventBus.flush()).ok, true)
  assert.equal(sent.length, 2)
  assert.match(sent[0], /BOT STARTED/)
  assert.match(sent[1], /ORDER FILLED/)
  assert.deepEqual(eventBusErrors, [])
  assert.equal(subscriber.getDiagnostics().deliveredCount, 2)

  await subscriber.close()
  assert.equal((await eventBus.close()).ok, true)
  assert.equal(subscriber.getDiagnostics().closed, true)
})

test("lets the real EventBus observe delivery failures when no subscriber logger exists", async () => {
  const reported = []
  const eventBus = new EventBus({
    onError: async ({ error, eventName }) => {
      reported.push({ message: error.message, eventName })
    },
  })
  const subscriber = subscribeTelegramNotifications({
    eventBus,
    notifier: { async sendMessage() { throw new Error("telegram offline") } },
  })

  assert.equal(eventBus.publish({
    name: "bot.started",
    source: "integration-test",
  }).ok, true)
  assert.equal((await eventBus.flush()).ok, true)
  assert.deepEqual(reported, [{
    message: "telegram offline",
    eventName: "bot.started",
  }])
  assert.equal(subscriber.getDiagnostics().failedCount, 1)

  await subscriber.close()
  await eventBus.close()
})
