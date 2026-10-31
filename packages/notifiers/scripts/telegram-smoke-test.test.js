import test from "node:test"
import assert from "node:assert/strict"
import { runTelegramSmokeTest } from "./telegram-smoke.js"

const timestamp = new Date("2026-10-31T12:00:00.000Z")

test("sends one clearly labeled message using injected credentials and clock", async () => {
  const created = []
  const sent = []
  const result = await runTelegramSmokeTest({
    env: {
      TELEGRAM_BOT_TOKEN: "test-token",
      TELEGRAM_CHAT_ID: "-100123",
    },
    now: () => timestamp,
    createNotifier(options) {
      created.push(options)
      return {
        async sendMessage(message) {
          sent.push(message)
          return { message_id: 42 }
        },
      }
    },
  })

  assert.deepEqual(created, [{
    token: "test-token",
    chatId: "-100123",
  }])
  assert.equal(sent.length, 1)
  assert.match(sent[0], /COINZILLA TELEGRAM SMOKE TEST/)
  assert.match(sent[0], /2026-10-31T12:00:00.000Z/)
  assert.deepEqual(result, { messageId: 42 })
  assert.equal(Object.isFrozen(result), true)
})

test("rejects invalid environment before creating a notifier", async () => {
  let created = false
  for (const env of [
    undefined,
    null,
    [],
    {},
    { TELEGRAM_BOT_TOKEN: "test-token" },
    { TELEGRAM_CHAT_ID: "-100123" },
    { TELEGRAM_BOT_TOKEN: " ", TELEGRAM_CHAT_ID: "-100123" },
    { TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_CHAT_ID: [] },
  ]) {
    await assert.rejects(
      runTelegramSmokeTest({
        env,
        createNotifier() {
          created = true
          return { async sendMessage() { return { message_id: 1 } } }
        },
      }),
      /env|must both be configured/,
    )
  }
  assert.equal(created, false)
})

test("validates the clock and notifier boundary", async () => {
  const env = {
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_CHAT_ID: "-100123",
  }

  await assert.rejects(
    runTelegramSmokeTest({ env, now: () => "not a date" }),
    /valid Date/,
  )
  await assert.rejects(
    runTelegramSmokeTest({ env, createNotifier: () => ({}) }),
    /sendMessage/,
  )
})

test("propagates transport failures without retrying", async () => {
  let calls = 0
  await assert.rejects(
    runTelegramSmokeTest({
      env: {
        TELEGRAM_BOT_TOKEN: "test-token",
        TELEGRAM_CHAT_ID: "-100123",
      },
      createNotifier: () => ({
        async sendMessage() {
          calls += 1
          throw new Error("network unavailable")
        },
      }),
    }),
    /network unavailable/,
  )
  assert.equal(calls, 1)
})

test("rejects malformed success results", async () => {
  for (const result of [null, {}, { message_id: 0 }, { message_id: "42" }]) {
    await assert.rejects(
      runTelegramSmokeTest({
        env: {
          TELEGRAM_BOT_TOKEN: "test-token",
          TELEGRAM_CHAT_ID: "-100123",
        },
        createNotifier: () => ({
          async sendMessage() { return result },
        }),
      }),
      /invalid message_id/,
    )
  }
})
