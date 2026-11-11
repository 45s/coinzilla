import nodeTest from "node:test"
const test = (name, ...args) => nodeTest("[telegram-operator-adapter.test.js] " + name, ...args)
import assert from "node:assert/strict"
import {
  createTelegramOperatorAdapter,
  parseTelegramOperatorCommand,
} from "./telegram-operator-adapter.js"

function makeResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

function makeUpdate({
  updateId = 100,
  userId = 12345,
  chatId = 12345,
  chatType = "private",
  text = "/pause LINKUSDT",
} = {}) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1700000000,
      from: { id: userId, is_bot: false },
      chat: { id: chatId, type: chatType },
      text,
    },
  }
}

test("parses only the initial pause command and accepts a command addressed to this bot", () => {
  assert.deepEqual(parseTelegramOperatorCommand("/pause linkusdt", { botUsername: "coinzilla_bot" }), {
    type: "PAUSE",
    symbol: "LINKUSDT",
  })
  assert.deepEqual(parseTelegramOperatorCommand("/pause@coinzilla_bot LINKUSDT", { botUsername: "coinzilla_bot" }), {
    type: "PAUSE",
    symbol: "LINKUSDT",
  })
})

test("ignores ordinary text and commands addressed to another bot", () => {
  assert.deepEqual(parseTelegramOperatorCommand("hello"), { type: "IGNORE" })
  assert.deepEqual(
    parseTelegramOperatorCommand("/pause@another_bot LINKUSDT", { botUsername: "coinzilla_bot" }),
    { type: "IGNORE" },
  )
})

test("rejects malformed pause syntax and does not expose unimplemented commands", () => {
  assert.deepEqual(parseTelegramOperatorCommand("/pause"), { type: "INVALID" })
  assert.deepEqual(parseTelegramOperatorCommand("/pause LINKUSDT extra"), { type: "INVALID" })
  assert.deepEqual(parseTelegramOperatorCommand("/pause LINK-USDT"), { type: "INVALID" })
  assert.deepEqual(parseTelegramOperatorCommand("/resume LINKUSDT"), { type: "UNSUPPORTED" })
})

test("polls serially, maps an allowlisted private sender to an actor, and acknowledges pause", async () => {
  const update = makeUpdate()
  const calls = []
  const sentMessages = []
  const pollRequests = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise((resolve) => { finishSecondPoll = resolve })
  const operator = {
    pauseMarket: async (request) => {
      calls.push(request)
      return {
        ok: true,
        data: { symbol: request.symbol, paused: true, alreadyPaused: false, durable: true },
        errors: [],
      }
    },
  }
  const fetchImpl = async (url, options = {}) => {
    const method = url.split("/").pop()
    if (method === "getMe") {
      return makeResponse({ ok: true, result: { id: 99, username: "coinzilla_bot" } })
    }
    if (method === "getUpdates") {
      const params = JSON.parse(options.body)
      pollRequests.push(params)
      pollCount += 1
      if (pollCount === 1) return makeResponse({ ok: true, result: [update] })
      finishSecondPoll()
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(new Error("poll aborted"))
        }, { once: true })
      })
    }
    if (method === "sendMessage") {
      sentMessages.push(JSON.parse(options.body))
      return makeResponse({ ok: true, result: { message_id: 200 } })
    }
    throw new Error("Unexpected Telegram API method: " + method)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator,
    fetchImpl,
    retryDelayMs: 1,
  })

  await adapter.start()
  await secondPoll
  await adapter.stop()

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], {
    actor: { id: "telegram-user:12345", roles: ["trading-operator"] },
    requestId: "telegram:100:1700000000:12345",
    symbol: "LINKUSDT",
  })
  assert.equal(sentMessages.length, 1)
  assert.equal(sentMessages[0].chat_id, 12345)
  assert.match(sentMessages[0].text, /Paused LINKUSDT/)
  assert.match(sentMessages[0].text, /Existing exchange orders remain open and may still fill/)
  assert.equal(pollRequests[1].offset, 101, "The update offset must advance only after the command and reply are handled.")
})

test("does not invoke the application for a user outside the private-chat allowlist", async () => {
  const update = makeUpdate({ userId: 99999, chatId: 99999, updateId: 101 })
  const calls = []
  const sentMessages = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise((resolve) => { finishSecondPoll = resolve })
  const fetchImpl = async (url, options = {}) => {
    const method = url.split("/").pop()
    if (method === "getMe") return makeResponse({ ok: true, result: { username: "coinzilla_bot" } })
    if (method === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) return makeResponse({ ok: true, result: [update] })
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          finishSecondPoll()
          reject(new Error("poll aborted"))
        }, { once: true })
      })
    }
    if (method === "sendMessage") {
      sentMessages.push(JSON.parse(options.body))
      return makeResponse({ ok: true, result: { message_id: 201 } })
    }
    throw new Error("Unexpected Telegram API method: " + method)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator: { pauseMarket: async (request) => calls.push(request) },
    fetchImpl,
    retryDelayMs: 1,
  })

  await adapter.start()
  await secondPoll
  await adapter.stop()

  assert.deepEqual(calls, [], "An unallowlisted Telegram sender must never reach the application use case.")
  assert.equal(sentMessages.length, 1)
  assert.equal(sentMessages[0].text, "Not authorized.")
})

test("ignores group messages even when their sender ID is allowlisted", async () => {
  const update = makeUpdate({ chatId: -100123, chatType: "group" })
  const sentMessages = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise((resolve) => { finishSecondPoll = resolve })
  const fetchImpl = async (url, options = {}) => {
    const method = url.split("/").pop()
    if (method === "getMe") return makeResponse({ ok: true, result: { username: "coinzilla_bot" } })
    if (method === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) return makeResponse({ ok: true, result: [update] })
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          finishSecondPoll()
          reject(new Error("poll aborted"))
        }, { once: true })
      })
    }
    if (method === "sendMessage") {
      sentMessages.push(JSON.parse(options.body))
      return makeResponse({ ok: true, result: { message_id: 202 } })
    }
    throw new Error("Unexpected Telegram API method: " + method)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator: { pauseMarket: async () => assert.fail("Group messages must not reach the operator use case.") },
    fetchImpl,
    retryDelayMs: 1,
  })

  await adapter.start()
  await secondPoll
  await adapter.stop()

  assert.deepEqual(sentMessages, [], "Group chats must be ignored without sending operator responses.")
})

test("fails adapter startup when Telegram bot identity cannot be verified", async () => {
  let updateRequests = 0
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator: { pauseMarket: async () => ({ ok: true }) },
    fetchImpl: async () => makeResponse({ ok: false, description: "Unauthorized" }, 401),
  })

  await assert.rejects(adapter.start(), /Telegram API getMe failed/)
  assert.equal(updateRequests, 0)
})
