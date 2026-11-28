import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const domainConfigPath = fileURLToPath(new URL("./app-config.js", import.meta.url))

test("domain app config remains independent of Telegram transport configuration", async () => {
  const source = await readFile(domainConfigPath, "utf8")
  assert.doesNotMatch(source, /notifications-tg-profiles|TELEGRAM_NOTIFICATION_EVENT_KEYS|validateTelegramNotificationConfig|validateTelegramOperatorControlConfig/, "Domain config must not import Telegram profiles, define Telegram event catalogues, or validate transport-specific Telegram configuration.")
})
