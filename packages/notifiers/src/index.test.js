import test from "node:test"
import assert from "node:assert/strict"
import {
  TelegramNotifier,
  subscribeTelegramNotifications,
  TELEGRAM_NOTIFICATION_EVENTS,
  formatTelegramNotification,
  formatNotification,
} from "./index.js"

test("public entry point exports the Telegram transport API", () => {
  assert.equal(typeof TelegramNotifier, "function")
  assert.equal(typeof subscribeTelegramNotifications, "function")
  assert.equal(typeof formatTelegramNotification, "function")
  assert.equal(formatNotification, formatTelegramNotification)
  assert.ok(TELEGRAM_NOTIFICATION_EVENTS.includes("order.filled"))
})


test("package self-reference resolves the supported public export surface", async () => {
  const api = await import("@coinzilla/notifiers")
  assert.equal(api.TelegramNotifier, TelegramNotifier)
  assert.equal(api.subscribeTelegramNotifications, subscribeTelegramNotifications)
  assert.equal(api.formatTelegramNotification, formatTelegramNotification)
  assert.equal(api.formatNotification, formatNotification)
  assert.deepEqual(api.TELEGRAM_NOTIFICATION_EVENTS, TELEGRAM_NOTIFICATION_EVENTS)
})
