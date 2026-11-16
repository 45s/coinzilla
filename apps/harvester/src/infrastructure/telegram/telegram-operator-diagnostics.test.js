import nodeTest from "node:test"
const test = (name, ...args) => nodeTest("[telegram-operator-diagnostics.test.js] " + name, ...args)
import assert from "node:assert/strict"
import { createTelegramOperatorDiagnostics } from "./telegram-operator-diagnostics.js"

test("preserves nested error details while redacting bot tokens and excluding Telegram identities", () => {
  const botToken = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn"
  const cause = new TypeError("request failed for " + botToken)
  const error = Object.assign(new Error("Telegram API request failed: sendMessage " + botToken, { cause }), {
    code: "TELEGRAM_SEND_FAILED",
    context: {
      component: "harvester.operator",
      operation: "sendMessage",
      symbol: "LINKUSDT",
      userId: "12345",
      chatId: "12345",
    },
  })
  const diagnostics = createTelegramOperatorDiagnostics({ botToken })
  const details = diagnostics.describeError(error)
  const serialized = JSON.stringify(details)
  assert.equal(serialized.includes(botToken), false)
  assert.equal(details.code, "TELEGRAM_SEND_FAILED")
  assert.equal(details.cause.message.includes("[REDACTED]"), true)
  assert.deepEqual(details.context, {
    component: "harvester.operator",
    operation: "sendMessage",
    symbol: "LINKUSDT",
  })
  assert.equal(serialized.includes("12345"), false)
})
