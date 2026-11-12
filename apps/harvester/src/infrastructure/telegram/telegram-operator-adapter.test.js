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

test("parses help, start, pause and resume commands", () => {
  assert.deepEqual(parseTelegramOperatorCommand("/start"), { type: "HELP" })
  assert.deepEqual(parseTelegramOperatorCommand("/help"), { type: "HELP" })
  assert.deepEqual(parseTelegramOperatorCommand("/resume linkusdt"), { type: "RESUME", symbol: "LINKUSDT" })
  assert.deepEqual(parseTelegramOperatorCommand("/resume"), { type: "INVALID", command: "RESUME" })
})

test("parses read-only status and market queries without arguments", () => {
  assert.deepEqual(parseTelegramOperatorCommand("/status"), { type: "STATUS" })
  assert.deepEqual(parseTelegramOperatorCommand("/markets"), { type: "MARKETS" })
  assert.deepEqual(parseTelegramOperatorCommand("/status extra"), { type: "INVALID", command: "STATUS" })
})

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
  assert.deepEqual(parseTelegramOperatorCommand("/pause"), { type: "INVALID", command: "PAUSE" })
  assert.deepEqual(parseTelegramOperatorCommand("/pause LINKUSDT extra"), { type: "INVALID", command: "PAUSE" })
  assert.deepEqual(parseTelegramOperatorCommand("/pause LINK-USDT"), { type: "INVALID", command: "PAUSE" })
  assert.deepEqual(parseTelegramOperatorCommand("/pause@coinzilla_bot@another_bot LINKUSDT", { botUsername: "coinzilla_bot" }), { type: "INVALID" })
  assert.deepEqual(parseTelegramOperatorCommand("/cancel LINKUSDT"), { type: "UNSUPPORTED" })
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
      if (pollCount === 1) {return makeResponse({ ok: true, result: [update] })}
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
    if (method === "getMe") {return makeResponse({ ok: true, result: { username: "coinzilla_bot" } })}
    if (method === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {return makeResponse({ ok: true, result: [update] })}
      finishSecondPoll()
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
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
    if (method === "getMe") {return makeResponse({ ok: true, result: { username: "coinzilla_bot" } })}
    if (method === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {return makeResponse({ ok: true, result: [update] })}
      finishSecondPoll()
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
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

test("dispatches resume through the application facade and preserves safety blockers", async () => {
  const update = makeUpdate({ updateId: 110, text: "/resume LINKUSDT" })
  const calls = []
  const sentMessages = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise((resolve) => { finishSecondPoll = resolve })
  const fetchImpl = async (url, options = {}) => {
    const method = url.split("/").pop()
    if (method === "getMe") {return makeResponse({ ok: true, result: { username: "coinzilla_bot" } })}
    if (method === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {return makeResponse({ ok: true, result: [update] })}
      finishSecondPoll()
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (method === "sendMessage") {
      sentMessages.push(JSON.parse(options.body))
      return makeResponse({ ok: true, result: { message_id: 210 } })
    }
    throw new Error("Unexpected Telegram API method: " + method)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator: {
      pauseMarket: async () => assert.fail("Resume must not call pauseMarket."),
      resumeMarket: async (request) => {
        calls.push(request)
        return { ok: false, data: undefined, errors: [{ code: "SAFETY_BLOCKER_ACTIVE" }] }
      },
    },
    fetchImpl,
    retryDelayMs: 1,
  })
  await adapter.start()
  await secondPoll
  await adapter.stop()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].symbol, "LINKUSDT")
  assert.match(sentMessages[0].text, /safety, recovery, or volatility blocker/)
})

test("answers /help without invoking trading use cases", async () => {
  const update = makeUpdate({ updateId: 111, text: "/help" })
  const sentMessages = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise((resolve) => { finishSecondPoll = resolve })
  const fetchImpl = async (url, options = {}) => {
    const method = url.split("/").pop()
    if (method === "getMe") {return makeResponse({ ok: true, result: { username: "coinzilla_bot" } })}
    if (method === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {return makeResponse({ ok: true, result: [update] })}
      finishSecondPoll()
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (method === "sendMessage") {
      sentMessages.push(JSON.parse(options.body))
      return makeResponse({ ok: true, result: { message_id: 211 } })
    }
    throw new Error("Unexpected Telegram API method: " + method)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator: { pauseMarket: async () => assert.fail("Help must not invoke pauseMarket.") },
    fetchImpl,
    retryDelayMs: 1,
  })
  await adapter.start()
  await secondPoll
  await adapter.stop()
  assert.equal(sentMessages.length, 1)
  assert.match(sentMessages[0].text, /Harvester Command Center/)
  assert.match(sentMessages[0].text, /resume SYMBOL/)
})

test("fails adapter startup when Telegram bot identity cannot be verified", async () => {
  const updateRequests = 0
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator: { pauseMarket: async () => ({ ok: true }) },
    fetchImpl: async () => makeResponse({ ok: false, description: "Unauthorized" }, 401),
  })

  await assert.rejects(adapter.start(), /Telegram API getMe failed/)
  assert.equal(updateRequests, 0)
})

test("retries an unacknowledged Telegram update with the same application request ID", async () => {
  const update = makeUpdate({ updateId: 303 })
  const operatorCalls = []
  let updatePollCount = 0
  let sendCount = 0
  let finishThirdPoll
  const thirdPoll = new Promise((resolve) => { finishThirdPoll = resolve })
  const fetchImpl = async (url, options = {}) => {
    const method = url.split("/").pop()
    if (method === "getMe") {return makeResponse({ ok: true, result: { username: "coinzilla_bot" } })}
    if (method === "getUpdates") {
      updatePollCount += 1
      if (updatePollCount <= 2) {return makeResponse({ ok: true, result: [update] })}
      finishThirdPoll()
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (method === "sendMessage") {
      sendCount += 1
      if (sendCount === 1) {throw new Error("temporary reply delivery failure")}
      return makeResponse({ ok: true, result: { message_id: 303 } })
    }
    throw new Error("Unexpected Telegram API method: " + method)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator: {
      pauseMarket: async (request) => {
        operatorCalls.push(request)
        return {
          ok: true,
          data: {
            symbol: request.symbol,
            paused: true,
            alreadyPaused: operatorCalls.length > 1,
            durable: true,
          },
        }
      },
    },
    fetchImpl,
    retryDelayMs: 1,
  })

  await adapter.start()
  await thirdPoll
  await adapter.stop()

  assert.equal(operatorCalls.length, 2, "The same pending update is retried after an ambiguous reply failure.")
  assert.equal(
    operatorCalls[0].requestId,
    operatorCalls[1].requestId,
    "The adapter must preserve a stable request ID so the application durable-fact port can deduplicate retries.",
  )
  assert.equal(sendCount, 2)
})

test("concurrent start calls share one Telegram identity check and one poller", async () => {
  let getMeCalls = 0
  let pollCalls = 0
  let resolveIdentity
  const identity = new Promise((resolve) => { resolveIdentity = resolve })
  let finishPoll
  const pollStarted = new Promise((resolve) => { finishPoll = resolve })
  const fetchImpl = async (url, options = {}) => {
    const method = url.split("/").pop()
    if (method === "getMe") {
      getMeCalls += 1
      const result = await identity
      return makeResponse({ ok: true, result })
    }
    if (method === "getUpdates") {
      pollCalls += 1
      finishPoll()
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    throw new Error("Unexpected Telegram API method: " + method)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator: { pauseMarket: async () => ({ ok: true }) },
    fetchImpl,
    retryDelayMs: 1,
  })

  const firstStart = adapter.start()
  const secondStart = adapter.start()
  assert.equal(getMeCalls, 1, "Concurrent start calls must share the same startup request.")
  resolveIdentity({ username: "coinzilla_bot" })
  await Promise.all([firstStart, secondStart])
  await pollStarted
  await adapter.stop()

  assert.equal(pollCalls, 1, "Only one long-poll loop may be active for one adapter instance.")
})



test("ignores a private-chat update whose chat identity does not match its allowlisted sender", async () => {
  const update = makeUpdate({ userId: 12345, chatId: 54321 })
  const calls = []
  const sentMessages = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise((resolve) => { finishSecondPoll = resolve })
  const fetchImpl = async (url, options = {}) => {
    const method = url.split("/").pop()
    if (method === "getMe") {return makeResponse({ ok: true, result: { username: "coinzilla_bot" } })}
    if (method === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {return makeResponse({ ok: true, result: [update] })}
      finishSecondPoll()
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (method === "sendMessage") {
      sentMessages.push(JSON.parse(options.body))
      return makeResponse({ ok: true, result: { message_id: 304 } })
    }
    throw new Error("Unexpected Telegram API method: " + method)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator: {
      pauseMarket: async (request) => {
        calls.push(request)
        return { ok: true, data: { symbol: request.symbol, paused: true, durable: true } }
      },
    },
    fetchImpl,
    retryDelayMs: 1,
  })

  await adapter.start()
  await secondPoll
  await adapter.stop()

  assert.deepEqual(
    calls,
    [],
    "A private-chat update must not reach the operator use case when its chat ID differs from the authenticated sender ID.",
  )
  assert.deepEqual(
    sentMessages,
    [],
    "A mismatched private-chat identity must be ignored without replying to an unrelated chat.",
  )
})

test("dispatches authorized read-only status and market queries without invoking trading controls", async () => {
  const updates = [
    makeUpdate({ updateId: 112, text: "/status" }),
    makeUpdate({ updateId: 113, text: "/markets" }),
  ]
  const queryCalls = []
  const sentMessages = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise((resolve) => { finishSecondPoll = resolve })
  const fetchImpl = async (url, options = {}) => {
    const method = url.split("/").pop()
    if (method === "getMe") {return makeResponse({ ok: true, result: { username: "coinzilla_bot" } })}
    if (method === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {return makeResponse({ ok: true, result: updates })}
      if (pollCount === 2) {
        finishSecondPoll()
        return makeResponse({ ok: true, result: [] })
      }
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (method === "sendMessage") {
      sentMessages.push(JSON.parse(options.body))
      return makeResponse({ ok: true, result: { message_id: 212 } })
    }
    throw new Error("Unexpected Telegram API method: " + method)
  }
  const operator = {
    pauseMarket: async () => assert.fail("Read-only queries must never invoke pauseMarket."),
    resumeMarket: async () => assert.fail("Read-only queries must never invoke resumeMarket."),
    getStatus: async (request) => {
      queryCalls.push({ type: "status", request })
      return {
        ok: true,
        data: {
          connected: true,
          tradingMode: "testnet",
          tradingEnabled: true,
          strategyMode: "conservative",
          readiness: { state: "BLOCKED", blockers: ["AUTHORITATIVE_RECONCILIATION_REQUIRED"] },
          userData: { ready: false, status: "AUTHORITATIVE_RECONCILIATION_REQUIRED", ageMs: 1000 },
          markets: { configured: 2, enabled: 2, blocked: 1 },
        },
      }
    },
    getMarkets: async (request) => {
      queryCalls.push({ type: "markets", request })
      return {
        ok: true,
        data: {
          tradingEnabled: true,
          markets: [{
            symbol: "DOGEUSDT",
            enabled: true,
            readiness: "BLOCKED",
            latestPrice: "0.12",
            priceFresh: false,
            blockers: ["USER_DATA_NOT_READY", "MARKET_PRICE_STALE"],
            operatorPaused: false,
            safetyPaused: false,
            volatilityProtection: { mode: "PROTECTED", reason: "HIGH_VOLATILITY" },
          }],
        },
      }
    },
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

  assert.deepEqual(
    queryCalls.map(({ type }) => type),
    ["status", "markets"],
    "The adapter must route /status and /markets to their read-only application queries in update order.",
  )
  assert.equal(queryCalls[0].request.actor.id, "telegram-user:12345", "The status query must receive the authenticated application actor.")
  assert.equal(queryCalls[1].request.actor.roles.includes("trading-operator"), true, "The market query must receive the authorized operator role.")
  assert.equal(sentMessages.length, 2, "Each read-only command must receive exactly one Telegram response.")
  assert.match(sentMessages[0].text, /Readiness: BLOCKED/, "The status response must not hide a closed readiness gate.")
  assert.match(sentMessages[0].text, /AUTHORITATIVE_RECONCILIATION_REQUIRED/, "The status response must name its actual readiness blocker.")
  assert.match(sentMessages[1].text, /DOGEUSDT/, "The market response must identify the configured market.")
  assert.match(sentMessages[1].text, /MARKET_PRICE_STALE/, "The market response must identify stale price data.")
  assert.match(sentMessages[1].text, /PROTECTED/, "The market response must expose the volatility protection state.")
})

test("logs structured operator query failures without exposing diagnostics to Telegram", async () => {
  const updates = [makeUpdate({ updateId: 114, text: "/status" })]
  const sentMessages = []
  const loggedErrors = []
  let pollCount = 0
  let finishFirstPoll
  const firstPoll = new Promise((resolve) => { finishFirstPoll = resolve })
  const internalCause = new Error("private internal snapshot failure")
  const queryError = Object.assign(new Error("Operator runtime snapshot could not be read"), {
    name: "OperatorQueryError",
    code: "HARVESTER_OPERATOR_RUNTIME_SNAPSHOT_READ_FAILED",
    cause: internalCause,
    context: { component: "harvester.operator", operation: "READ_STATUS" },
  })
  const fetchImpl = async (url, options = {}) => {
    const method = url.split("/").pop()
    if (method === "getMe") {return makeResponse({ ok: true, result: { username: "coinzilla_bot" } })}
    if (method === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {return makeResponse({ ok: true, result: updates })}
      if (pollCount === 2) {
        finishFirstPoll()
        return makeResponse({ ok: true, result: [] })
      }
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (method === "sendMessage") {
      sentMessages.push(JSON.parse(options.body))
      return makeResponse({ ok: true, result: { message_id: 213 } })
    }
    throw new Error("Unexpected Telegram API method: " + method)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator: {
      pauseMarket: async () => assert.fail("A failed read-only query must not invoke the pause command."),
      getStatus: async () => ({ ok: false, errors: [queryError] }),
    },
    logger: { error: (entry) => loggedErrors.push(entry) },
    fetchImpl,
    retryDelayMs: 1,
  })

  await adapter.start()
  await firstPoll
  await adapter.stop()

  assert.equal(loggedErrors.length, 1, "A failed operator query must emit one actionable structured diagnostic.")
  assert.equal(loggedErrors[0].component, "harvester.operator", "The diagnostic must identify the owning operator component.")
  assert.equal(loggedErrors[0].operation, "getStatus", "The diagnostic must identify the failed query operation.")
  assert.equal(loggedErrors[0].error[0], queryError, "The logger must receive the original typed error object without stringification.")
  assert.equal(loggedErrors[0].error[0].cause, internalCause, "The diagnostic must preserve the original lower-level cause.")
  assert.equal(sentMessages.length, 1, "The operator must receive one safe failure response for the failed query.")
  assert.doesNotMatch(sentMessages[0].text, /private internal snapshot failure/, "Telegram must not expose internal error messages or causes.")
})


test("parses CC-2 trading visibility commands without arguments", () => {
  assert.deepEqual(parseTelegramOperatorCommand("/positions"), { type: "POSITIONS" })
  assert.deepEqual(parseTelegramOperatorCommand("/orders"), { type: "ORDERS" })
  assert.deepEqual(parseTelegramOperatorCommand("/balances"), { type: "BALANCES" })
  assert.deepEqual(parseTelegramOperatorCommand("/orders extra"), { type: "INVALID", command: "ORDERS" })
})


function makeCallbackUpdate({ updateId = 500, callbackId = "callback-500", userId = 12345, chatId = 12345, messageId = 700, data = "cc:nav:status" } = {}) {
  return {
    update_id: updateId,
    callback_query: {
      id: callbackId,
      from: { id: userId, is_bot: false },
      message: { message_id: messageId, chat: { id: chatId, type: "private" } },
      data,
    },
  }
}

test("registers the supported command menu and requests callback updates", async () => {
  const calls = []
  let finishPoll
  const pollStarted = new Promise(resolve => { finishPoll = resolve })
  const fetchImpl = async (url, options = {}) => {
    const method = url.split("/").pop()
    calls.push({ method, payload: options.body ? JSON.parse(options.body) : {} })
    if (method === "getMe") { return makeResponse({ ok: true, result: { username: "coinzilla_bot" } }) }
    if (method === "setMyCommands") { return makeResponse({ ok: true, result: true }) }
    if (method === "getUpdates") {
      finishPoll()
      return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true }))
    }
    throw new Error("Unexpected Telegram API method: " + method)
  }
  const adapter = createTelegramOperatorAdapter({ botToken: "test-token", allowedUserIds: ["12345"], operator: { pauseMarket: async () => ({ ok: true }) }, fetchImpl, retryDelayMs: 1 })
  await adapter.start()
  await pollStarted
  await adapter.stop()
  const menu = calls.find(call => call.method === "setMyCommands")
  assert.ok(menu, "The adapter must register the Telegram command menu during startup.")
  assert.ok(menu.payload.commands.some(command => command.command === "status"), "The registered menu must include read-only status.")
  assert.ok(menu.payload.commands.some(command => command.command === "pause"), "The registered menu must include the supported pause control.")
  const polling = calls.find(call => call.method === "getUpdates")
  assert.deepEqual(polling.payload.allowed_updates, ["message", "callback_query"], "Long polling must receive both text commands and inline callback actions.")
})

test("requires explicit confirmation before applying a text pause command", async () => {
  const update = makeUpdate({ updateId: 501, text: "/pause LINKUSDT" })
  const sentMessages = []
  const operatorCalls = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise(resolve => { finishSecondPoll = resolve })
  const fetchImpl = async (url, options = {}) => {
    const method = url.split("/").pop()
    if (method === "getMe") { return makeResponse({ ok: true, result: { username: "coinzilla_bot" } }) }
    if (method === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) { return makeResponse({ ok: true, result: [update] }) }
      finishSecondPoll()
      return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true }))
    }
    if (method === "sendMessage") { sentMessages.push(JSON.parse(options.body)); return makeResponse({ ok: true, result: { message_id: 701 } }) }
    if (method === "setMyCommands") { return makeResponse({ ok: true, result: true }) }
    throw new Error("Unexpected Telegram API method: " + method)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token", allowedUserIds: ["12345"],
    operator: { pauseMarket: async request => { operatorCalls.push(request); return { ok: true, data: { symbol: request.symbol } } } },
    fetchImpl, retryDelayMs: 1,
  })
  await adapter.start()
  await secondPoll
  await adapter.stop()
  assert.deepEqual(operatorCalls, [], "A text control command must not mutate operator state before explicit confirmation.")
  assert.match(sentMessages[0].text, /Confirm pause of LINKUSDT/)
  assert.equal(sentMessages[0].reply_markup.inline_keyboard[0][0].callback_data.startsWith("cc:confirm:"), true)
  assert.equal(sentMessages[0].reply_markup.inline_keyboard[0][1].callback_data.startsWith("cc:cancel:"), true)
})

test("accepts an authorized one-time inline confirmation and executes the existing application use case", async () => {
  const updates = [
    makeUpdate({ updateId: 502, text: "/pause LINKUSDT" }),
    makeCallbackUpdate({ updateId: 503, callbackId: "callback-503", messageId: 702, data: "cc:confirm:PAUSE:LINKUSDT:502" }),
  ]
  const operatorCalls = []
  const callbackAnswers = []
  const editedMessages = []
  let pollCount = 0
  let finishThirdPoll
  const thirdPoll = new Promise(resolve => { finishThirdPoll = resolve })
  const fetchImpl = async (url, options = {}) => {
    const method = url.split("/").pop()
    if (method === "getMe") { return makeResponse({ ok: true, result: { username: "coinzilla_bot" } }) }
    if (method === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) { return makeResponse({ ok: true, result: [updates[0]] }) }
      if (pollCount === 2) { return makeResponse({ ok: true, result: [updates[1]] }) }
      finishThirdPoll()
      return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true }))
    }
    if (method === "sendMessage") { return makeResponse({ ok: true, result: { message_id: 702 } }) }
    if (method === "answerCallbackQuery") { callbackAnswers.push(JSON.parse(options.body)); return makeResponse({ ok: true, result: true }) }
    if (method === "editMessageText") { editedMessages.push(JSON.parse(options.body)); return makeResponse({ ok: true, result: true }) }
    if (method === "setMyCommands") { return makeResponse({ ok: true, result: true }) }
    throw new Error("Unexpected Telegram API method: " + method)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token", allowedUserIds: ["12345"],
    operator: { pauseMarket: async request => { operatorCalls.push(request); return { ok: true, data: { symbol: request.symbol, alreadyPaused: false } } } },
    fetchImpl, retryDelayMs: 1,
  })
  await adapter.start()
  await thirdPoll
  await adapter.stop()
  assert.equal(operatorCalls.length, 1, "The confirmed callback must execute exactly one operator action.")
  assert.equal(operatorCalls[0].symbol, "LINKUSDT")
  assert.equal(operatorCalls[0].requestId, "telegram:callback:callback-503", "The callback identity must remain stable for application-level durable idempotency.")
  assert.equal(callbackAnswers.length, 1, "The Telegram callback must receive an acknowledgement.")
  assert.match(editedMessages[0].text, /Paused LINKUSDT/)
})

test("rejects inline callbacks from users outside the allowlist without invoking the application", async () => {
  const update = makeCallbackUpdate({ updateId: 504, userId: 99999, data: "cc:nav:status" })
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise(resolve => { finishSecondPoll = resolve })
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    const method = url.split("/").pop()
    if (method === "getMe") { return makeResponse({ ok: true, result: { username: "coinzilla_bot" } }) }
    if (method === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) { return makeResponse({ ok: true, result: [update] }) }
      finishSecondPoll()
      return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true }))
    }
    if (method === "answerCallbackQuery") { calls.push(JSON.parse(options.body)); return makeResponse({ ok: true, result: true }) }
    if (method === "setMyCommands") { return makeResponse({ ok: true, result: true }) }
    throw new Error("Unexpected Telegram API method: " + method)
  }
  const adapter = createTelegramOperatorAdapter({ botToken: "test-token", allowedUserIds: ["12345"], operator: { pauseMarket: async () => assert.fail("Unauthorized callback must not reach the operator."), getStatus: async () => assert.fail("Unauthorized callback must not read operator state.") }, fetchImpl, retryDelayMs: 1 })
  await adapter.start()
  await secondPoll
  await adapter.stop()
  assert.equal(calls.length, 0, "An unauthorized callback must not be acknowledged as a valid operator action.")
})

test("renders an inline status navigation callback using the read-only application query", async () => {
  const update = makeCallbackUpdate({ updateId: 505, data: "cc:nav:status", messageId: 705 })
  const queries = []
  const edits = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise(resolve => { finishSecondPoll = resolve })
  const fetchImpl = async (url, options = {}) => {
    const method = url.split("/").pop()
    if (method === "getMe") { return makeResponse({ ok: true, result: { username: "coinzilla_bot" } }) }
    if (method === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) { return makeResponse({ ok: true, result: [update] }) }
      finishSecondPoll()
      return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true }))
    }
    if (method === "answerCallbackQuery") { return makeResponse({ ok: true, result: true }) }
    if (method === "editMessageText") { edits.push(JSON.parse(options.body)); return makeResponse({ ok: true, result: true }) }
    if (method === "setMyCommands") { return makeResponse({ ok: true, result: true }) }
    throw new Error("Unexpected Telegram API method: " + method)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token", allowedUserIds: ["12345"],
    operator: {
      pauseMarket: async () => assert.fail("Navigation must remain read-only."),
      getStatus: async request => { queries.push(request); return { ok: true, data: { runtimeState: "RUNNING", tradingEnabled: false, userData: { ready: false }, readiness: { state: "TRADING_DISABLED", blockers: [] }, markets: { enabled: 1, configured: 1, blocked: 0 }, observedAt: 1700000000000 } } },
    },
    fetchImpl, retryDelayMs: 1,
  })
  await adapter.start()
  await secondPoll
  await adapter.stop()
  assert.equal(queries.length, 1, "Inline status navigation must call only the authorized read-only query.")
  assert.equal(queries[0].actor.id, "telegram-user:12345")
  assert.match(edits[0].text, /Harvester status/)
  assert.equal(edits[0].reply_markup.inline_keyboard.length > 0, true, "Rendered pages must retain safe navigation and refresh controls.")
})
