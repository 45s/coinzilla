import test from "node:test"
import assert from "node:assert/strict"
import { EventBus } from "@coinzilla/event-bus"
import { prepareTelegramNotifications } from "./prepare-telegram-notifications.js"

function createEventBus({ failAt } = {}) {
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
          },
        },
      }
    },
  }
}

test("notifications are disabled when both Telegram credentials are absent", () => {
  const result = prepareTelegramNotifications({ env: {} })
  assert.equal(result.ok, true)
  assert.equal(result.data, null)
})

test("notifications fail fast when credentials are incomplete or invalid", () => {
  for (const env of [
    { TELEGRAM_BOT_TOKEN: "123:secret" },
    { TELEGRAM_CHAT_ID: "-100123" },
    { TELEGRAM_BOT_TOKEN: " ", TELEGRAM_CHAT_ID: "-100123" },
    { TELEGRAM_BOT_TOKEN: "123:secret", TELEGRAM_CHAT_ID: "" },
    { TELEGRAM_BOT_TOKEN: 123, TELEGRAM_CHAT_ID: "-100123" },
    { TELEGRAM_BOT_TOKEN: "123:secret", TELEGRAM_CHAT_ID: [] },
  ]) {
    const result = prepareTelegramNotifications({ env })
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /must both be configured/)
  }
})

test("valid credentials register the Telegram subscriber and expose cleanup", async () => {
  const eventBus = createEventBus()
  const createdOptions = []
  const result = prepareTelegramNotifications({
    eventBus,
    env: { TELEGRAM_BOT_TOKEN: "123:secret", TELEGRAM_CHAT_ID: "-100123" },
    createNotifier(options) {
      createdOptions.push(options)
      return { async sendMessage() {} }
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(createdOptions, [{ token: "123:secret", chatId: "-100123" }])
  assert.ok(eventBus.handlers.has("order.filled"))
  assert.ok(eventBus.handlers.has("bot.pair_paused"))
  await result.data.close()
  assert.equal(eventBus.unsubscribed.length, 7)
})

test("returns setup errors and preserves the original cause", () => {
  const errors = []
  const result = prepareTelegramNotifications({
    eventBus: createEventBus(),
    env: { TELEGRAM_BOT_TOKEN: "123:secret", TELEGRAM_CHAT_ID: "-100123" },
    createNotifier() {
      throw new Error("invalid test configuration")
    },
    logger: { error(entry) { errors.push(entry) } },
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /invalid test configuration/)
  assert.equal(errors.length, 1)
})

test("does not hide setup errors when logging fails", () => {
  const result = prepareTelegramNotifications({
    eventBus: createEventBus(),
    env: { TELEGRAM_BOT_TOKEN: "123:secret", TELEGRAM_CHAT_ID: "-100123" },
    createNotifier() {
      throw new Error("setup failure")
    },
    logger: { error() { throw new Error("logger failure") } },
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /setup failure/)
})

test("validates environment input", () => {
  assert.equal(prepareTelegramNotifications({ env: null }).ok, false)
  assert.equal(prepareTelegramNotifications({ env: [] }).ok, false)
})

test("returns setup errors when the event bus or notifier contract is invalid", () => {
  const env = { TELEGRAM_BOT_TOKEN: "123:secret", TELEGRAM_CHAT_ID: "-100123" }
  const missingBus = prepareTelegramNotifications({
    env,
    createNotifier: () => ({ async sendMessage() {} }),
    logger: { error() {} },
  })
  assert.equal(missingBus.ok, false)
  assert.match(missingBus.errors[0].message, /eventBus/)

  const invalidNotifier = prepareTelegramNotifications({
    eventBus: createEventBus(),
    env,
    createNotifier: () => ({}),
    logger: { error() {} },
  })
  assert.equal(invalidNotifier.ok, false)
  assert.match(invalidNotifier.errors[0].message, /sendMessage/)
})


test("connects the app configuration to the real EventBus and drains on close", async () => {
  const eventBusErrors = []
  const eventBus = new EventBus({
    logger: { error(entry) { eventBusErrors.push(entry) } },
  })
  const sent = []
  const result = prepareTelegramNotifications({
    eventBus,
    env: { TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_CHAT_ID: "-100123" },
    createNotifier: () => ({
      async sendMessage(message) { sent.push(message) },
    }),
  })

  assert.equal(result.ok, true)
  assert.equal(eventBus.publish({
    name: "bot.started",
    source: "free-roll-integration-test",
  }).ok, true)
  assert.equal(eventBus.publish({
    name: "order.execution_report",
    source: "free-roll-integration-test",
    data: { raw: "not forwarded" },
  }).ok, true)

  assert.equal((await eventBus.flush()).ok, true)
  assert.deepEqual(sent, ["🟢 BOT STARTED"])
  assert.deepEqual(eventBusErrors, [])

  await result.data.close()
  assert.equal((await eventBus.close()).ok, true)
})
