import test from "node:test"
import assert from "node:assert/strict"
import {
  TelegramNotifier,
  subscribeTelegramNotifications,
} from "./index.js"

test("public entry point exports the Telegram transport API", () => {
  assert.equal(typeof TelegramNotifier, "function")
  assert.equal(typeof subscribeTelegramNotifications, "function")
})


test("package self-reference resolves the supported public export surface", async () => {
  const api = await import("@coinzilla/notifiers")
  assert.equal(api.TelegramNotifier, TelegramNotifier)
  assert.equal(api.subscribeTelegramNotifications, subscribeTelegramNotifications)
})
