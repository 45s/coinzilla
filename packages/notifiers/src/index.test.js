import test from "node:test"
import assert from "node:assert/strict"
import {
  TelegramNotifier,
  subscribeTelegramNotifications,
  TELEGRAM_NOTIFICATION_EVENTS,
  formatNotification,
} from "./index.js"

test("public entry point exports the supported notifier API", () => {
  assert.equal(typeof TelegramNotifier, "function")
  assert.equal(typeof subscribeTelegramNotifications, "function")
  assert.equal(typeof formatNotification, "function")
  assert.ok(TELEGRAM_NOTIFICATION_EVENTS.includes("order.filled"))
})
