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
    null,
    [],
    {},
    { token: 2, chatId: "y" },
    { token: "x" },
    { token: "x", chatId: "" },
    { token: "x", chatId: {} },
    { token: "x", chatId: "y", fetchImpl: 1 },
    { token: "x", chatId: "y", timeoutMs: 0 },
    { token: "x", chatId: "y", timeoutMs: 2_147_483_648 },
  ]) assert.throws(() => new TelegramNotifier(options))

  assert.doesNotThrow(() => new TelegramNotifier({ token: "123:secret", chatId: -100 }))
})

test("normalizes whitespace around credentials and sends a bounded request", async () => {
  let captured
  const notifier = new TelegramNotifier({
    token: " 123:secret-token ",
    chatId: " -100123 ",
    timeoutMs: 1500,
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
  assert.equal(captured.options.signal.aborted, false)
})

test("rejects invalid text before making a request", async () => {
  let calls = 0
  const notifier = new TelegramNotifier({
    token: "x",
    chatId: "y",
    fetchImpl: async () => { calls += 1 },
  })

  for (const message of ["", "   ", "x".repeat(4097), null]) {
    await assert.rejects(notifier.sendMessage(message))
  }
  assert.equal(calls, 0)
})

test("reports HTTP failures without exposing token", async () => {
  const notifier = new TelegramNotifier({
    token: "123456:secret-token",
    chatId: "y",
    fetchImpl: async () => response({}, false, 503),
  })

  await assert.rejects(notifier.sendMessage("hello"), /status 503/)
  await assert.rejects(
    notifier.sendMessage("hello"),
    (error) => !error.message.includes("123456:secret-token"),
  )

  const unknownStatus = new TelegramNotifier({
    token: "x",
    chatId: "y",
    fetchImpl: async () => response({}, false, null),
  })
  await assert.rejects(unknownStatus.sendMessage("hello"), /status unknown/)
})

test("reports Telegram API errors and redacts reflected credentials", async () => {
  const rejected = new TelegramNotifier({
    token: "123456:secret-token",
    chatId: "y",
    fetchImpl: async () => response({
      ok: false,
      description: "invalid token 123456:secret-token",
    }),
  })

  await assert.rejects(rejected.sendMessage("hello"), (error) => {
    assert.match(error.message, /invalid token/)
    assert.doesNotMatch(error.message, /123456:secret-token/)
    return true
  })

  const unknown = new TelegramNotifier({
    token: "x",
    chatId: "y",
    fetchImpl: async () => response(null),
  })
  await assert.rejects(unknown.sendMessage("hello"), /unknown Telegram API error/)
})

test("rejects malformed HTTP responses and malformed successful Bot API payloads", async () => {
  const malformedResponses = [
    null,
    {},
    { ok: true },
  ]

  for (const fetchImpl of malformedResponses.map((value) => async () => value)) {
    const notifier = new TelegramNotifier({ token: "x", chatId: "y", fetchImpl })
    await assert.rejects(notifier.sendMessage("hello"), /invalid HTTP response/)
  }

  for (const payload of [
    { ok: true },
    { ok: true, result: null },
    { ok: true, result: {} },
    { ok: true, result: { message_id: 0 } },
    { ok: true, result: { message_id: "7" } },
  ]) {
    const notifier = new TelegramNotifier({
      token: "x",
      chatId: "y",
      fetchImpl: async () => response(payload),
    })
    await assert.rejects(notifier.sendMessage("hello"), /without a valid message_id/)
  }
})

test("sanitizes transport and JSON parsing errors", async () => {
  const transport = new TelegramNotifier({
    token: "123456:secret-token",
    chatId: "y",
    fetchImpl: async () => {
      throw new Error("request failed for 123456:secret-token")
    },
  })
  await assert.rejects(transport.sendMessage("hello"), (error) => {
    assert.match(error.message, /request failed/)
    assert.doesNotMatch(error.message, /123456:secret-token/)
    assert.equal(error.cause, undefined)
    return true
  })

  const invalidJson = new TelegramNotifier({
    token: "123456:secret-token",
    chatId: "y",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        throw new Error("bad JSON for 123456:secret-token")
      },
    }),
  })
  await assert.rejects(invalidJson.sendMessage("hello"), (error) => {
    assert.match(error.message, /bad JSON/)
    assert.doesNotMatch(error.message, /123456:secret-token/)
    return true
  })
})
