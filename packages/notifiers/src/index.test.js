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
