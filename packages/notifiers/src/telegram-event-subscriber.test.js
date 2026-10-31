import test from "node:test"
import assert from "node:assert/strict"
import { subscribeTelegramNotifications, TELEGRAM_NOTIFICATION_EVENTS } from "./telegram-event-subscriber.js"

function createEventBus({ failAt } = {}) {
  const handlers = new Map()
  const unsubscribed = []
  return {
    handlers,
    unsubscribed,
    subscribe({ name, handler }) {
      if (name === failAt) return { ok: false }
      handlers.set(name, handler)
      return { ok: true, subscription: { unsubscribe() { unsubscribed.push(name); return { unsubscribed: true } } } }
    },
  }
}

test("subscribes only to the explicit notification allowlist and delivers events", async () => {
  const eventBus = createEventBus()
  const messages = []
  const subscriber = subscribeTelegramNotifications({ eventBus, notifier: { async sendMessage(message) { messages.push(message) } } })
  assert.deepEqual([...eventBus.handlers.keys()], [...TELEGRAM_NOTIFICATION_EVENTS])
  await eventBus.handlers.get("order.filled")({ name: "order.filled", data: { symbol: "BTCUSDT" } })
  assert.match(messages[0], /ORDER FILLED/)
  await subscriber.close()
  await subscriber.close()
  assert.equal(eventBus.unsubscribed.length, TELEGRAM_NOTIFICATION_EVENTS.length)
})

test("serializes deliveries and drains accepted handler work on close", async () => {
  const eventBus = createEventBus()
  const sent = []
  let release
  const first = new Promise((resolve) => { release = resolve })
  const subscriber = subscribeTelegramNotifications({
    eventBus,
    notifier: { async sendMessage(message) { sent.push(message); if (sent.length === 1) await first } },
  })
  const firstDelivery = eventBus.handlers.get("bot.started")({ name: "bot.started", data: {} })
  const secondDelivery = eventBus.handlers.get("bot.stopped")({ name: "bot.stopped", data: {} })
  await Promise.resolve()
  assert.equal(sent.length, 1)
  let closed = false
  const closing = subscriber.close().then(() => { closed = true })
  await Promise.resolve()
  assert.equal(closed, false)
  release()
  await Promise.all([firstDelivery, secondDelivery, closing])
  assert.equal(sent.length, 2)
  assert.equal(closed, true)
})

test("logs delivery errors and continues processing later events", async () => {
  const eventBus = createEventBus()
  const errors = []
  let calls = 0
  const subscriber = subscribeTelegramNotifications({
    eventBus,
    notifier: { async sendMessage() { calls += 1; if (calls === 1) throw new Error("network down") } },
    logger: { error(entry) { errors.push(entry) } },
  })
  await assert.rejects(eventBus.handlers.get("bot.started")({ name: "bot.started", data: {} }), /network down/)
  await eventBus.handlers.get("bot.stopped")({ name: "bot.stopped", data: {} })
  assert.equal(errors.length, 1)
  assert.equal(calls, 2)
  await subscriber.close()
})

test("unsubscribes partial registrations when setup fails", () => {
  const eventBus = createEventBus({ failAt: TELEGRAM_NOTIFICATION_EVENTS[2] })
  assert.throws(() => subscribeTelegramNotifications({ eventBus, notifier: { sendMessage() {} } }), /Unable to subscribe/)
  assert.equal(eventBus.unsubscribed.length, 2)
})

test("rejects a malformed subscription handle and cleans up prior handles", () => {
  const eventBus = createEventBus()
  const originalSubscribe = eventBus.subscribe
  eventBus.subscribe = (options) => {
    if (options.name === TELEGRAM_NOTIFICATION_EVENTS[1]) return { ok: true, subscription: {} }
    return originalSubscribe(options)
  }
  assert.throws(() => subscribeTelegramNotifications({ eventBus, notifier: { sendMessage() {} } }), /Unable to subscribe/)
  assert.equal(eventBus.unsubscribed.length, 1)
})

test("validates dependencies and tolerates logger failure", async () => {
  assert.throws(() => subscribeTelegramNotifications({}), /eventBus/)
  assert.throws(() => subscribeTelegramNotifications({ eventBus: {} }), /eventBus/)
  assert.throws(() => subscribeTelegramNotifications({ eventBus: createEventBus() }), /notifier/)
  assert.throws(() => subscribeTelegramNotifications({ eventBus: createEventBus(), notifier: {} , logger: { error: true } }), /logger.error/)
  const warnings = []
  const originalEmitWarning = process.emitWarning
  process.emitWarning = (message) => warnings.push(message)
  try {
    const eventBus = createEventBus()
    const subscriber = subscribeTelegramNotifications({
      eventBus,
      notifier: { async sendMessage() { throw new Error("send failed") } },
      logger: { error() { throw new Error("log failed") } },
    })
    await assert.rejects(eventBus.handlers.get("bot.started")({ name: "bot.started", data: {} }), /send failed/)
    assert.equal(warnings.length, 1)
    await subscriber.close()
  } finally {
    process.emitWarning = originalEmitWarning
  }
})

test("delivery failures remain observable when no logger is configured", async () => {
  const eventBus = createEventBus()
  const subscriber = subscribeTelegramNotifications({ eventBus, notifier: { async sendMessage() { throw new Error("no logger path") } } })
  await assert.rejects(eventBus.handlers.get("bot.started")({ name: "bot.started", data: {} }), /no logger path/)
  await subscriber.close()
})
