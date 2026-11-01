import test from "node:test"
import assert from "node:assert/strict"
import {
  validateTelegramMessage,
  validateTelegramOptions,
} from "./telegram-validation.js"

test("normalizes valid Telegram options and applies explicit defaults", () => {
  const fetchImpl = async () => {}
  assert.deepEqual(
    validateTelegramOptions({
      token: " token ",
      chatId: " -100 ",
      timeoutMs: 1500,
    }, fetchImpl),
    { token: "token", chatId: "-100", fetchImpl, timeoutMs: 1500 },
  )
})

test("rejects malformed options and invalid timeout boundaries", () => {
  for (const options of [null, [], {}, { token: 1, chatId: "chat" },
    { token: "token", chatId: {} }, { token: "token", chatId: "chat", fetchImpl: 1 },
    { token: "token", chatId: "chat", timeoutMs: 0 },
    { token: "token", chatId: "chat", timeoutMs: 2_147_483_648 }]) {
    assert.throws(() => validateTelegramOptions(options, async () => {}))
  }
})

test("validates message type, emptiness, and Telegram length before I/O", () => {
  for (const message of [null, "", "  ", "x".repeat(4097)]) {
    assert.throws(() => validateTelegramMessage(message))
  }
  assert.doesNotThrow(() => validateTelegramMessage("x".repeat(4096)))
})
