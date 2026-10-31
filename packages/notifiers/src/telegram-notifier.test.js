import test from "node:test"
import assert from "node:assert/strict"
import { TelegramNotifier } from "./telegram-notifier.js"

const response = (body, ok = true, status = 200) => ({
  ok,
  status,
  async json() { return body },
})

test("constructor validates required options and bounds", () => {
  for (const options of [
    null, [], {}, { token: 2, chatId: "y" }, { token: "x" }, { token: "x", chatId: "" },
    { token: "x", chatId: {} }, { token: "x", chatId: "y", fetchImpl: 1 },
    { token: "x", chatId: "y", timeoutMs: 0 }, { token: "x", chatId: "y", timeoutMs: 2_147_483_648 },
  ]) assert.throws(() => new TelegramNotifier(options))
  assert.doesNotThrow(() => new TelegramNotifier({ token: "123:secret", chatId: -100 }))
})

test("sendMessage posts JSON to Telegram and returns result", async () => {
  let captured
  const notifier = new TelegramNotifier({
    token: "123:secret-token",
    chatId: -100123,
    fetchImpl: async (url, options) => {
      captured = { url, options }
      return response({ ok: true, result: { message_id: 7 } })
    },
  })
  assert.deepEqual(await notifier.sendMessage("hello"), { message_id: 7 })
  assert.equal(captured.url, "https://api.telegram.org/bot123:secret-token/sendMessage")
  assert.equal(captured.options.method, "POST")
  assert.deepEqual(JSON.parse(captured.options.body), { chat_id: "-100123", text: "hello" })
  assert.ok(captured.options.signal)
})

test("sendMessage rejects invalid text before making a request", async () => {
  let calls = 0
  const notifier = new TelegramNotifier({ token: "x", chatId: "y", fetchImpl: async () => { calls += 1 } })
  for (const text of ["", "   ", "x".repeat(4097), null]) await assert.rejects(notifier.sendMessage(text))
  assert.equal(calls, 0)
})

test("sendMessage reports HTTP failures without exposing token", async () => {
  const notifier = new TelegramNotifier({ token: "secret", chatId: "y", fetchImpl: async () => response({}, false, 503) })
  await assert.rejects(notifier.sendMessage("hello"), /status 503/)
  await assert.rejects(notifier.sendMessage("hello"), (error) => !error.message.includes("secret"))
  const unknownStatus = new TelegramNotifier({ token: "x", chatId: "y", fetchImpl: async () => response({}, false, null) })
  await assert.rejects(unknownStatus.sendMessage("hello"), /status unknown/)
})

test("sendMessage reports Telegram API errors", async () => {
  const rejected = new TelegramNotifier({ token: "x", chatId: "y", fetchImpl: async () => response({ ok: false, description: "chat not found" }) })
  await assert.rejects(rejected.sendMessage("hello"), /chat not found/)
  const unknown = new TelegramNotifier({ token: "x", chatId: "y", fetchImpl: async () => response(null) })
  await assert.rejects(unknown.sendMessage("hello"), /unknown Telegram API error/)
})

test("sendMessage rejects malformed responses and propagates transport failures", async () => {
  const malformed = new TelegramNotifier({ token: "x", chatId: "y", fetchImpl: async () => ({ ok: true }) })
  await assert.rejects(malformed.sendMessage("hello"), /invalid HTTP response/)
  const noResponse = new TelegramNotifier({ token: "x", chatId: "y", fetchImpl: async () => null })
  await assert.rejects(noResponse.sendMessage("hello"), /invalid HTTP response/)
  const brokenJson = new TelegramNotifier({ token: "x", chatId: "y", fetchImpl: async () => ({ ok: true, async json() { throw new Error("bad json") } }) })
  await assert.rejects(brokenJson.sendMessage("hello"), /bad json/)
  const offline = new TelegramNotifier({ token: "x", chatId: "y", fetchImpl: async () => { throw new Error("offline") } })
  await assert.rejects(offline.sendMessage("hello"), /offline/)
})
