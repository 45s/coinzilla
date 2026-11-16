import nodeTest from "node:test"
const test = (...args) => {
  const [name, ...testArguments] = args
  return nodeTest(`[telegram-operator-adapter.test.js] ${  name}`, ...testArguments)
}
import assert from "node:assert/strict"
import {
  createTelegramOperatorAdapter,
  parseTelegramOperatorCommand,
} from "./telegram-operator-adapter.js"

function makeResponse(...args) {
  const [payload, status = 200] = args
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
      from: { id: userId,
is_bot: false },
      chat: { id: chatId,
type: chatType },
      text,
    },
  }
}

test("parses help, start, pause and resume commands", () => {
  assert.deepEqual(parseTelegramOperatorCommand("/start"), { type: "START" })
  assert.deepEqual(parseTelegramOperatorCommand("/help"), { type: "HELP" })
  assert.deepEqual(parseTelegramOperatorCommand("/resume linkusdt"), { type: "RESUME",
symbol: "LINKUSDT" })
  assert.deepEqual(parseTelegramOperatorCommand("/resume"), { type: "INVALID",
command: "RESUME" })
})

test("parses read-only status and market queries without arguments", () => {
  assert.deepEqual(parseTelegramOperatorCommand("/status"), { type: "STATUS" })
  assert.deepEqual(parseTelegramOperatorCommand("/markets"), { type: "MARKETS" })
  assert.deepEqual(parseTelegramOperatorCommand("/status extra"), { type: "INVALID",
command: "STATUS" })
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
  assert.deepEqual(parseTelegramOperatorCommand("/pause"), { type: "INVALID",
command: "PAUSE" })
  assert.deepEqual(parseTelegramOperatorCommand("/pause LINKUSDT extra"), { type: "INVALID",
command: "PAUSE" })
  assert.deepEqual(parseTelegramOperatorCommand("/pause LINK-USDT"), { type: "INVALID",
command: "PAUSE" })
  assert.deepEqual(parseTelegramOperatorCommand("/pause@coinzilla_bot@another_bot LINKUSDT", { botUsername: "coinzilla_bot" }), { type: "INVALID" })
  assert.deepEqual(parseTelegramOperatorCommand("/cancel LINKUSDT"), { type: "UNSUPPORTED" })
})

function assertPauseInteractionDiagnostics({ entries }) {
  const interactionEntries = entries.filter(entry => entry.correlationId === "telegram:100")
  const expectedMessages = [
    "Telegram update RECEIVED",
    "Telegram interaction AUTHORIZED",
    "Telegram command STARTED",
    "Telegram application operation STARTED",
    "Telegram application operation COMPLETED",
    "Telegram response SENT",
  ]
  for (const message of expectedMessages) {
    assert.equal(
      interactionEntries.some(entry => entry.message === message),
      true,
      `${message} must be logged for an allowlisted pause command.`,
    )
  }
  assert.equal(
    interactionEntries.every(entry => entry.action === "PAUSE"),
    true,
    "Every diagnostic for the pause command must carry its action name.",
  )
}

function createPauseAcknowledgementOperator({ calls }) {
  return {
    pauseMarket: async (request) => {
      calls.push(request)
      return {
        ok: true,
        data: {
          symbol: request.symbol,
          paused: true,
          alreadyPaused: false,
          durable: true,
        },
        errors: [],
      }
    },
  }
}

function createPauseAcknowledgementFetch({ update, sentMessages, pollRequests }) {
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise((resolve) => {
    finishSecondPoll = resolve
  })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") {
      return makeResponse({
        ok: true,
        result: { id: 99, username: "coinzilla_bot" },
      })
    }
    if (telegramApiMethod === "getUpdates") {
      const params = JSON.parse(telegramRequestOptions.body)
      pollRequests.push(params)
      pollCount += 1
      if (pollCount === 1) {
        return makeResponse({ ok: true, result: [update] })
      }
      finishSecondPoll()
      return new Promise((...promiseArguments) => {
        const [, reject] = promiseArguments
        telegramRequestOptions.signal.addEventListener("abort", () => {
          reject(new Error("poll aborted"))
        }, { once: true })
      })
    }
    if (telegramApiMethod === "sendMessage") {
      sentMessages.push(JSON.parse(telegramRequestOptions.body))
      return makeResponse({ ok: true, result: { message_id: 200 } })
    }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  return { fetchImpl, secondPoll }
}

test("polls serially, maps an allowlisted private sender to an actor, and acknowledges pause", async () => {
  const update = makeUpdate()
  const calls = []
  const sentMessages = []
  const pollRequests = []
  const diagnosticEntries = []
  const operator = createPauseAcknowledgementOperator({ calls })
  const { fetchImpl, secondPoll } = createPauseAcknowledgementFetch({
    update,
    sentMessages,
    pollRequests,
  })
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator,
    logger: {
      debug: (entry) => diagnosticEntries.push(entry),
      info: (entry) => diagnosticEntries.push(entry),
      warn: (entry) => diagnosticEntries.push(entry),
      error: (entry) => diagnosticEntries.push(entry),
    },
    fetchImpl,
    retryDelayMs: 1,
  })

  await adapter.start()
  await secondPoll
  await adapter.stop()

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], {
    actor: {
      id: "telegram-user:12345",
      roles: ["trading-operator"],
    },
    requestId: "telegram:100:1700000000:12345",
    symbol: "LINKUSDT",
  })
  assert.equal(sentMessages.length, 1)
  assert.equal(sentMessages[0].chat_id, 12345)
  assert.match(sentMessages[0].text, /Paused LINKUSDT/)
  assert.match(sentMessages[0].text, /Existing exchange orders remain open and may still fill/)
  assert.equal(
    pollRequests[1].offset,
    101,
    "The update offset must advance only after the command and reply are handled.",
  )
  assertPauseInteractionDiagnostics({ entries: diagnosticEntries })
})
test("does not invoke the application for a user outside the private-chat allowlist", async () => {
  const update = makeUpdate({ userId: 99999,
chatId: 99999,
updateId: 101 })
  const calls = []
  const sentMessages = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise((resolve) => { finishSecondPoll = resolve })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") {return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } })}
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {return makeResponse({ ok: true,
result: [update] })}
      finishSecondPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => {
          reject(new Error("poll aborted"))
        }, { once: true })
      })
    }
    if (telegramApiMethod === "sendMessage") {
      sentMessages.push(JSON.parse(telegramRequestOptions.body))
      return makeResponse({ ok: true,
result: { message_id: 201 } })
    }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
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
  const update = makeUpdate({ chatId: -100123,
chatType: "group" })
  const sentMessages = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise((resolve) => { finishSecondPoll = resolve })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") {return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } })}
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {return makeResponse({ ok: true,
result: [update] })}
      finishSecondPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => {
          reject(new Error("poll aborted"))
        }, { once: true })
      })
    }
    if (telegramApiMethod === "sendMessage") {
      sentMessages.push(JSON.parse(telegramRequestOptions.body))
      return makeResponse({ ok: true,
result: { message_id: 202 } })
    }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
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
  const update = makeUpdate({ updateId: 110,
text: "/resume LINKUSDT" })
  const calls = []
  const sentMessages = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise((resolve) => { finishSecondPoll = resolve })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") {return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } })}
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {return makeResponse({ ok: true,
result: [update] })}
      finishSecondPoll()
      return new Promise(promiseArgs => {
        const [, reject] = promiseArgs
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "sendMessage") {
      sentMessages.push(JSON.parse(telegramRequestOptions.body))
      return makeResponse({ ok: true,
result: { message_id: 210 } })
    }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator: {
      pauseMarket: async () => assert.fail("Resume must not call pauseMarket."),
      resumeMarket: async (request) => {
        calls.push(request)
        return { ok: false,
data: undefined,
errors: [{ code: "SAFETY_BLOCKER_ACTIVE" }] }
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
  const update = makeUpdate({ updateId: 111,
text: "/help" })
  const sentMessages = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise((resolve) => { finishSecondPoll = resolve })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") {return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } })}
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {return makeResponse({ ok: true,
result: [update] })}
      finishSecondPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "sendMessage") {
      sentMessages.push(JSON.parse(telegramRequestOptions.body))
      return makeResponse({ ok: true,
result: { message_id: 211 } })
    }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
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
    fetchImpl: async () => makeResponse({ ok: false,
description: "Unauthorized" }, 401),
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
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") {return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } })}
    if (telegramApiMethod === "getUpdates") {
      updatePollCount += 1
      if (updatePollCount <= 2) {return makeResponse({ ok: true,
result: [update] })}
      finishThirdPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "sendMessage") {
      sendCount += 1
      if (sendCount === 1) {throw new Error("temporary reply delivery failure")}
      return makeResponse({ ok: true,
result: { message_id: 303 } })
    }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
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
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") {
      getMeCalls += 1
      const result = await identity
      return makeResponse({ ok: true,
result })
    }
    if (telegramApiMethod === "getUpdates") {
      pollCalls += 1
      finishPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
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
  const update = makeUpdate({ userId: 12345,
chatId: 54321 })
  const calls = []
  const sentMessages = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise((resolve) => { finishSecondPoll = resolve })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") {return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } })}
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {return makeResponse({ ok: true,
result: [update] })}
      finishSecondPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "sendMessage") {
      sentMessages.push(JSON.parse(telegramRequestOptions.body))
      return makeResponse({ ok: true,
result: { message_id: 304 } })
    }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator: {
      pauseMarket: async (request) => {
        calls.push(request)
        return { ok: true,
data: { symbol: request.symbol,
paused: true,
durable: true } }
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
    makeUpdate({ updateId: 112,
text: "/status" }),
    makeUpdate({ updateId: 113,
text: "/markets" }),
  ]
  const queryCalls = []
  const sentMessages = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise((resolve) => { finishSecondPoll = resolve })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") {return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } })}
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {return makeResponse({ ok: true,
result: updates })}
      if (pollCount === 2) {
        finishSecondPoll()
        return makeResponse({ ok: true,
result: [] })
      }
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "sendMessage") {
      sentMessages.push(JSON.parse(telegramRequestOptions.body))
      return makeResponse({ ok: true,
result: { message_id: 212 } })
    }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  const operator = {
    pauseMarket: async () => assert.fail("Read-only queries must never invoke pauseMarket."),
    resumeMarket: async () => assert.fail("Read-only queries must never invoke resumeMarket."),
    getStatus: async (request) => {
      queryCalls.push({ type: "status",
request })
      return {
        ok: true,
        data: {
          connected: true,
          tradingMode: "testnet",
          tradingEnabled: true,
          strategyMode: "conservative",
          readiness: { state: "BLOCKED",
blockers: ["AUTHORITATIVE_RECONCILIATION_REQUIRED"] },
          userData: { ready: false,
status: "AUTHORITATIVE_RECONCILIATION_REQUIRED",
ageMs: 1000 },
          markets: { configured: 2,
enabled: 2,
blocked: 1 },
        },
      }
    },
    getMarkets: async (request) => {
      queryCalls.push({ type: "markets",
request })
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
            volatilityProtection: { mode: "PROTECTED",
reason: "HIGH_VOLATILITY" },
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
  const updates = [makeUpdate({ updateId: 114,
text: "/status" })]
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
    context: { component: "harvester.operator",
operation: "READ_STATUS" },
  })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") {return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } })}
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {return makeResponse({ ok: true,
result: updates })}
      if (pollCount === 2) {
        finishFirstPoll()
        return makeResponse({ ok: true,
result: [] })
      }
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "sendMessage") {
      sentMessages.push(JSON.parse(telegramRequestOptions.body))
      return makeResponse({ ok: true,
result: { message_id: 213 } })
    }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator: {
      pauseMarket: async () => assert.fail("A failed read-only query must not invoke the pause command."),
      getStatus: async () => ({ ok: false,
errors: [queryError] }),
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
  assert.equal(loggedErrors[0].errorName, "OperatorQueryError", "The diagnostic must retain the original typed error name.")
  assert.equal(loggedErrors[0].errorCode, "HARVESTER_OPERATOR_RUNTIME_SNAPSHOT_READ_FAILED", "The diagnostic must retain the stable application error code.")
  assert.equal(loggedErrors[0].errorCause.message, internalCause.message, "The diagnostic must preserve the original lower-level cause.")
  assert.equal(loggedErrors[0].correlationId, "telegram:114", "The diagnostic must correlate the failure with its update.")
  assert.equal(sentMessages.length, 1, "The operator must receive one safe failure response for the failed query.")
  assert.doesNotMatch(sentMessages[0].text, /private internal snapshot failure/, "Telegram must not expose internal error messages or causes.")
})


test("parses CC-2 trading visibility commands without arguments", () => {
  assert.deepEqual(parseTelegramOperatorCommand("/positions"), { type: "POSITIONS" })
  assert.deepEqual(parseTelegramOperatorCommand("/orders"), { type: "ORDERS" })
  assert.deepEqual(parseTelegramOperatorCommand("/balances"), { type: "BALANCES" })
  assert.deepEqual(parseTelegramOperatorCommand("/orders extra"), { type: "INVALID",
command: "ORDERS" })
})


function makeCallbackUpdate({ updateId = 500, callbackId = `callback-${updateId}`, userId = 12345, chatId = 12345, messageId = 700, data = "cc:nav:status" } = {}) {
  return {
    update_id: updateId,
    callback_query: {
      id: callbackId,
      from: { id: userId,
is_bot: false },
      message: { message_id: messageId,
chat: { id: chatId,
type: "private" } },
      data,
    },
  }
}

test("registers the supported command menu and requests callback updates", async () => {
  const calls = []
  let finishPoll
  const pollStarted = new Promise(resolve => { finishPoll = resolve })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    calls.push({ method: telegramApiMethod,
payload: telegramRequestOptions.body ? JSON.parse(telegramRequestOptions.body) : {} })
    if (telegramApiMethod === "getMe") { return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } }) }
    if (telegramApiMethod === "setMyCommands") { return makeResponse({ ok: true,
result: true }) }
    if (telegramApiMethod === "getUpdates") {
      finishPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  const adapter = createTelegramOperatorAdapter({ botToken: "test-token",
allowedUserIds: ["12345"],
operator: { pauseMarket: async () => ({ ok: true }) },
fetchImpl,
retryDelayMs: 1 })
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

test("requires explicit confirmation before applying an inline pause control", async () => {
  const update = makeCallbackUpdate({ updateId: 501,
data: "cc:ask:PAUSE:LINKUSDT",
messageId: 701 })
  const editedMessages = []
  const operatorCalls = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise(resolve => { finishSecondPoll = resolve })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") { return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } }) }
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) { return makeResponse({ ok: true,
result: [update] }) }
      finishSecondPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "answerCallbackQuery") { return makeResponse({ ok: true,
result: true }) }
    if (telegramApiMethod === "editMessageText") { editedMessages.push(JSON.parse(telegramRequestOptions.body)); return makeResponse({ ok: true,
result: true }) }
    if (telegramApiMethod === "setMyCommands") { return makeResponse({ ok: true,
result: true }) }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
allowedUserIds: ["12345"],
    operator: { pauseMarket: async request => { operatorCalls.push(request); return { ok: true,
data: { symbol: request.symbol } } } },
    fetchImpl,
retryDelayMs: 1,
  })
  await adapter.start()
  await secondPoll
  await adapter.stop()
  assert.deepEqual(operatorCalls, [], "Opening an inline control confirmation must not mutate operator state.")
  assert.match(editedMessages[0].text, /Confirm pause of LINKUSDT/)
  assert.equal(editedMessages[0].reply_markup.inline_keyboard[0][0].callback_data.startsWith("cc:confirm:"), true)
  assert.equal(editedMessages[0].reply_markup.inline_keyboard[0][1].callback_data.startsWith("cc:cancel:"), true)
})

test("accepts an authorized one-time inline confirmation and executes the existing application use case", async () => {
  const updates = [
    makeCallbackUpdate({ updateId: 502,
callbackId: "callback-502",
messageId: 702,
data: "cc:ask:PAUSE:LINKUSDT" }),
    makeCallbackUpdate({ updateId: 503,
callbackId: "callback-503",
messageId: 702,
data: "cc:confirm:PAUSE:LINKUSDT:502" }),
  ]
  const operatorCalls = []
  const callbackAnswers = []
  const editedMessages = []
  let pollCount = 0
  let finishThirdPoll
  const thirdPoll = new Promise(resolve => { finishThirdPoll = resolve })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") { return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } }) }
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) { return makeResponse({ ok: true,
result: [updates[0]] }) }
      if (pollCount === 2) { return makeResponse({ ok: true,
result: [updates[1]] }) }
      finishThirdPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "sendMessage") { return makeResponse({ ok: true,
result: { message_id: 702 } }) }
    if (telegramApiMethod === "answerCallbackQuery") { callbackAnswers.push(JSON.parse(telegramRequestOptions.body)); return makeResponse({ ok: true,
result: true }) }
    if (telegramApiMethod === "editMessageText") { editedMessages.push(JSON.parse(telegramRequestOptions.body)); return makeResponse({ ok: true,
result: true }) }
    if (telegramApiMethod === "setMyCommands") { return makeResponse({ ok: true,
result: true }) }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
allowedUserIds: ["12345"],
    operator: { pauseMarket: async request => { operatorCalls.push(request); return { ok: true,
data: { symbol: request.symbol,
paused: true,
alreadyPaused: false } } } },
    fetchImpl,
retryDelayMs: 1,
  })
  await adapter.start()
  await thirdPoll
  await adapter.stop()
  assert.equal(operatorCalls.length, 1, "The confirmed callback must execute exactly one operator action.")
  assert.equal(operatorCalls[0].symbol, "LINKUSDT")
  assert.equal(operatorCalls[0].requestId, "telegram:callback:callback-503", "The callback identity must remain stable for application-level durable idempotency.")
  assert.equal(callbackAnswers.length, 2, "Both the request and confirmation callbacks must receive acknowledgements.")
  assert.match(editedMessages[1].text, /Paused LINKUSDT/)
})

test("rejects inline callbacks from users outside the allowlist without invoking the application", async () => {
  const update = makeCallbackUpdate({ updateId: 504,
userId: 99999,
chatId: 99999,
data: "cc:nav:status" })
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise(resolve => { finishSecondPoll = resolve })
  const calls = []
  const diagnosticEntries = []
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") { return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } }) }
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) { return makeResponse({ ok: true,
result: [update] }) }
      finishSecondPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "answerCallbackQuery") { calls.push(JSON.parse(telegramRequestOptions.body)); return makeResponse({ ok: true,
result: true }) }
    if (telegramApiMethod === "setMyCommands") { return makeResponse({ ok: true,
result: true }) }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  const adapter = createTelegramOperatorAdapter({ botToken: "test-token",
allowedUserIds: ["12345"],
operator: { pauseMarket: async () => assert.fail("Unauthorized callback must not reach the operator."),
getStatus: async () => assert.fail("Unauthorized callback must not read operator state.") },
logger: { debug: entry => diagnosticEntries.push(entry),
info: entry => diagnosticEntries.push(entry),
warn: entry => diagnosticEntries.push(entry),
error: entry => diagnosticEntries.push(entry) },
fetchImpl,
retryDelayMs: 1 })
  await adapter.start()
  await secondPoll
  await adapter.stop()
  const interactionFailures = diagnosticEntries.filter(entry => entry.message === "Telegram interaction FAILED")
  assert.deepEqual(interactionFailures, [], `Unauthorized callback handling must not fail internally: ${  JSON.stringify(interactionFailures)}`)
  assert.equal(calls.length, 1, "An unauthorized callback must be acknowledged so Telegram can dismiss its loading indicator.")
  assert.equal(calls[0].callback_query_id, "callback-504", "The acknowledgement must target the received callback only.")
  assert.equal(calls[0].text, "Not authorized.", "The acknowledgement must reveal no private diagnostic details.")
})

test("renders an inline status navigation callback using the read-only application query", async () => {
  const update = makeCallbackUpdate({ updateId: 505,
data: "cc:nav:status",
messageId: 705 })
  const queries = []
  const edits = []
  const diagnosticEntries = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise(resolve => { finishSecondPoll = resolve })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") { return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } }) }
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) { return makeResponse({ ok: true,
result: [update] }) }
      finishSecondPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "answerCallbackQuery") { return makeResponse({ ok: true,
result: true }) }
    if (telegramApiMethod === "editMessageText") { edits.push(JSON.parse(telegramRequestOptions.body)); return makeResponse({ ok: true,
result: true }) }
    if (telegramApiMethod === "setMyCommands") { return makeResponse({ ok: true,
result: true }) }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
allowedUserIds: ["12345"],
    operator: {
      pauseMarket: async () => assert.fail("Navigation must remain read-only."),
      getStatus: async request => { queries.push(request); return { ok: true,
data: { runtimeState: "RUNNING",
tradingEnabled: false,
userData: { ready: false },
readiness: { state: "TRADING_DISABLED",
blockers: [] },
markets: { enabled: 1,
configured: 1,
blocked: 0 },
observedAt: 1700000000000 } } },
    },
    logger: {
      debug: entry => diagnosticEntries.push(entry),
      info: entry => diagnosticEntries.push(entry),
      warn: entry => diagnosticEntries.push(entry),
      error: entry => diagnosticEntries.push(entry),
    },
    fetchImpl,
retryDelayMs: 1,
  })
  await adapter.start()
  await secondPoll
  await adapter.stop()
  const interactionFailures = diagnosticEntries.filter(entry => entry.message === "Telegram interaction FAILED")
  assert.deepEqual(interactionFailures, [], `Inline status navigation must not fail internally: ${  JSON.stringify(interactionFailures)}`)
  assert.equal(queries.length, 1, "Inline status navigation must call only the authorized read-only query.")
  assert.equal(queries[0].actor.id, "telegram-user:12345")
  assert.match(edits[0].text, /Harvester status/)
  assert.equal(edits[0].reply_markup.inline_keyboard.length > 0, true, "Rendered pages must retain safe navigation and refresh controls.")
})


test("consumes an inline confirmation only once even when Telegram redelivers the callback", async () => {
  const updates = [
    makeCallbackUpdate({ updateId: 601,
callbackId: "ask-601",
messageId: 801,
data: "cc:ask:PAUSE:LINKUSDT" }),
    makeCallbackUpdate({ updateId: 602,
callbackId: "confirm-602",
messageId: 801,
data: "cc:confirm:PAUSE:LINKUSDT:601" }),
    makeCallbackUpdate({ updateId: 603,
callbackId: "replay-603",
messageId: 801,
data: "cc:confirm:PAUSE:LINKUSDT:601" }),
  ]
  const operatorCalls = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise(resolve => { finishSecondPoll = resolve })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") { return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } }) }
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) { return makeResponse({ ok: true,
result: updates }) }
      finishSecondPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "answerCallbackQuery" || telegramApiMethod === "editMessageText" || telegramApiMethod === "setMyCommands") { return makeResponse({ ok: true,
result: true }) }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
allowedUserIds: ["12345"],
    operator: { pauseMarket: async request => { operatorCalls.push(request); return { ok: true,
data: { symbol: request.symbol } } } },
    fetchImpl,
retryDelayMs: 1,
  })
  await adapter.start()
  await secondPoll
  await adapter.stop()
  assert.equal(operatorCalls.length, 1, "A stale or replayed confirmation must never execute a second operator action.")
})

test("treats Telegram's unchanged-message refresh response as successful and continues polling", async () => {
  const update = makeCallbackUpdate({ updateId: 604,
data: "cc:refresh:status",
messageId: 804 })
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise(resolve => { finishSecondPoll = resolve })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") { return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } }) }
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) { return makeResponse({ ok: true,
result: [update] }) }
      finishSecondPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "answerCallbackQuery" || telegramApiMethod === "setMyCommands") { return makeResponse({ ok: true,
result: true }) }
    if (telegramApiMethod === "editMessageText") { return makeResponse({ ok: false,
description: "Bad Request: message is not modified" }, 400) }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
allowedUserIds: ["12345"],
    operator: { pauseMarket: async () => assert.fail("Refreshing status must never invoke a control use case."),
getStatus: async () => ({ ok: true,
data: { runtimeState: "RUNNING",
tradingEnabled: false,
userData: { ready: false },
readiness: { state: "TRADING_DISABLED",
blockers: [] },
markets: { enabled: 1,
configured: 1,
blocked: 0 },
observedAt: 1700000000000 } }) },
    fetchImpl,
retryDelayMs: 1,
  })
  await adapter.start()
  await secondPoll
  await adapter.stop()
  assert.equal(pollCount, 2, "An unchanged Telegram message is a successful refresh outcome, not a permanently retried update.")
})


test("cancels an inline pause confirmation without invoking the operator", async () => {
  const updates = [
    makeCallbackUpdate({ updateId: 701,
callbackId: "ask-701",
messageId: 901,
data: "cc:ask:PAUSE:LINKUSDT" }),
    makeCallbackUpdate({ updateId: 702,
callbackId: "cancel-702",
messageId: 901,
data: "cc:cancel:701" }),
  ]
  const operatorCalls = []
  const edits = []
  let pollCount = 0
  let finishThirdPoll
  const thirdPoll = new Promise(resolve => { finishThirdPoll = resolve })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") { return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } }) }
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) { return makeResponse({ ok: true,
result: [updates[0]] }) }
      if (pollCount === 2) { return makeResponse({ ok: true,
result: [updates[1]] }) }
      finishThirdPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "answerCallbackQuery") { return makeResponse({ ok: true,
result: true }) }
    if (telegramApiMethod === "editMessageText") { edits.push(JSON.parse(telegramRequestOptions.body)); return makeResponse({ ok: true,
result: true }) }
    if (telegramApiMethod === "setMyCommands") { return makeResponse({ ok: true,
result: true }) }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
allowedUserIds: ["12345"],
    operator: { pauseMarket: async request => { operatorCalls.push(request); return { ok: true,
data: { symbol: request.symbol } } } },
    fetchImpl,
retryDelayMs: 1,
  })
  await adapter.start()
  await thirdPoll
  await adapter.stop()
  assert.deepEqual(operatorCalls, [], "Cancelling a pending confirmation must never reach the application control use case.")
  assert.match(edits[1].text, /cancelled/i, "The inline message must clearly acknowledge cancellation.")
})


test("rejects malformed callbacks and acknowledges private-chat identity mismatches before application access", async () => {
  const updates = [
    makeCallbackUpdate({ updateId: 801,
callbackId: "malformed-801",
data: "cc:confirm:PAUSE:LINKUSDT:not-a-token" }),
    makeCallbackUpdate({ updateId: 802,
callbackId: "mismatched-802",
userId: 12345,
chatId: 54321,
data: "cc:nav:status" }),
  ]
  const callbackAnswers = []
  const queryCalls = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise(resolve => { finishSecondPoll = resolve })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") { return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } }) }
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) { return makeResponse({ ok: true,
result: updates }) }
      finishSecondPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "answerCallbackQuery") { callbackAnswers.push(JSON.parse(telegramRequestOptions.body)); return makeResponse({ ok: true,
result: true }) }
    if (telegramApiMethod === "setMyCommands") { return makeResponse({ ok: true,
result: true }) }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
allowedUserIds: ["12345"],
    operator: {
      pauseMarket: async () => assert.fail("Malformed or mismatched callbacks must never invoke a control use case."),
      getStatus: async request => { queryCalls.push(request); return { ok: true,
data: {} } },
    },
    fetchImpl,
retryDelayMs: 1,
  })
  await adapter.start()
  await secondPoll
  await adapter.stop()
  assert.equal(callbackAnswers.length, 2, "Both malformed and unauthorized callbacks must be acknowledged.")
  assert.match(callbackAnswers[0].text, /Unknown or expired action/)
  assert.match(callbackAnswers[1].text, /Not authorized/)
  assert.deepEqual(queryCalls, [], "A callback from a private chat that does not match its sender must be ignored.")
})


test("keeps authorized text commands available when Telegram command-menu registration is unavailable", async () => {
  const update = makeUpdate({ updateId: 901,
text: "/help" })
  const sentMessages = []
  const warnings = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise(resolve => { finishSecondPoll = resolve })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") { return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } }) }
    if (telegramApiMethod === "setMyCommands") { return makeResponse({ ok: false,
description: "Forbidden" }, 403) }
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) { return makeResponse({ ok: true,
result: [update] }) }
      finishSecondPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "sendMessage") { sentMessages.push(JSON.parse(telegramRequestOptions.body)); return makeResponse({ ok: true,
result: { message_id: 901 } }) }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
allowedUserIds: ["12345"],
    operator: { pauseMarket: async () => assert.fail("Help must not invoke an operator control.") },
    logger: { warn: entry => warnings.push(entry) },
    fetchImpl,
retryDelayMs: 1,
  })
  await adapter.start()
  await secondPoll
  await adapter.stop()
  assert.equal(warnings.length, 1, "A failed menu registration must be observable.")
  assert.match(warnings[0].message, /command menu registration failed/)
  assert.equal(sentMessages.length, 1, "The adapter must continue handling authorized text commands.")
  assert.match(sentMessages[0].text, /Harvester Command Center/)
})


test("shows only enabled configured markets as inline pause or resume controls", async () => {
  const update = makeCallbackUpdate({ updateId: 1001,
data: "cc:nav:markets",
messageId: 1001 })
  const edits = []
  const diagnosticEntries = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise(resolve => { finishSecondPoll = resolve })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") { return makeResponse({ ok: true,
result: { username: "coinzilla_bot" } }) }
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) { return makeResponse({ ok: true,
result: [update] }) }
      finishSecondPoll()
      return new Promise((...args) => {
        const [, reject] = args
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "answerCallbackQuery") { return makeResponse({ ok: true,
result: true }) }
    if (telegramApiMethod === "editMessageText") { edits.push(JSON.parse(telegramRequestOptions.body)); return makeResponse({ ok: true,
result: true }) }
    if (telegramApiMethod === "setMyCommands") { return makeResponse({ ok: true,
result: true }) }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
allowedUserIds: ["12345"],
    operator: {
      pauseMarket: async () => assert.fail("Rendering market controls must not mutate trading state."),
      getMarkets: async () => ({
        ok: true,
        data: {
          markets: [
            {
              symbol: "LINKUSDT",
              enabled: true,
              readiness: "READY",
              latestPrice: "10",
              priceFresh: true,
              operatorPaused: false,
              blockers: [],
            },
            {
              symbol: "BTCUSDT",
              enabled: true,
              readiness: "READY",
              latestPrice: "20",
              priceFresh: true,
              operatorPaused: true,
              blockers: [],
            },
            {
              symbol: "ETHUSDT",
              enabled: false,
              readiness: "DISABLED",
              latestPrice: null,
              priceFresh: false,
              operatorPaused: false,
              blockers: [],
            },
          ],
        },
      }),
    },
    logger: {
      debug: entry => diagnosticEntries.push(entry),
      info: entry => diagnosticEntries.push(entry),
      warn: entry => diagnosticEntries.push(entry),
      error: entry => diagnosticEntries.push(entry),
    },
    fetchImpl,
retryDelayMs: 1,
  })
  await adapter.start()
  await secondPoll
  await adapter.stop()
  const interactionFailures = diagnosticEntries.filter(entry => entry.message === "Telegram interaction FAILED")
  assert.deepEqual(interactionFailures, [], `Market navigation must not fail internally: ${JSON.stringify(interactionFailures)}`)
  const buttons = edits[0].reply_markup.inline_keyboard.flat()
  assert.ok(buttons.some(button => button.callback_data === "cc:ask:PAUSE:LINKUSDT"), "An enabled unpaused market must offer only a pause request.")
  assert.ok(buttons.some(button => button.callback_data === "cc:ask:RESUME:BTCUSDT"), "An enabled operator-paused market must offer only a resume request.")
  assert.equal(buttons.some(button => button.callback_data?.includes("ETHUSDT")), false, "Disabled markets must not expose operator controls.")
})


async function runTelegramUpdatesForDiagnostics({ updates, operator, logger, sendMessageError } = {}) {
  const sentMessages = []
  const callbackAnswers = []
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise(resolve => {
    finishSecondPoll = resolve
  })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") {
      return makeResponse({
        ok: true,
        result: { username: "coinzilla_bot" },
      })
    }
    if (telegramApiMethod === "setMyCommands" || telegramApiMethod === "editMessageText") {
      return makeResponse({
        ok: true,
        result: true,
      })
    }
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {
        return makeResponse({
          ok: true,
          result: updates,
        })
      }
      finishSecondPoll()
      return new Promise((...promiseArgs) => {
        const [, reject] = promiseArgs
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "sendMessage") {
      if (sendMessageError) {
        throw sendMessageError
      }
      sentMessages.push(JSON.parse(telegramRequestOptions.body))
      return makeResponse({
        ok: true,
        result: { message_id: 1200 },
      })
    }
    if (telegramApiMethod === "answerCallbackQuery") {
      callbackAnswers.push(JSON.parse(telegramRequestOptions.body))
      return makeResponse({
        ok: true,
        result: true,
      })
    }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator,
    logger,
    fetchImpl,
    retryDelayMs: 1,
  })
  await adapter.start()
  await secondPoll
  await adapter.stop()
  return {
    sentMessages,
    callbackAnswers,
  }
}

function createReadOnlyOperator({ calls }) {
  return {
    pauseMarket: async () => assert.fail("Read-only navigation must never pause a market."),
    resumeMarket: async () => assert.fail("Read-only navigation must never resume a market."),
    getStatus: async () => {
      calls.push("getStatus")
      return {
        ok: true,
        data: {
          runtimeState: "RUNNING",
          tradingEnabled: false,
          userData: {
            ready: false,
          },
          readiness: {
            state: "TRADING_DISABLED",
            blockers: [],
          },
          markets: {
            enabled: 0,
            configured: 0,
            blocked: 0,
          },
          observedAt: 1700000000000,
        },
      }
    },
    getMarkets: async () => {
      calls.push("getMarkets")
      return {
        ok: true,
        data: { markets: [] },
      }
    },
    getPositions: async () => {
      calls.push("getPositions")
      return {
        ok: true,
        data: {
          positions: [],
          observedAt: 1700000000000,
        },
      }
    },
    getOrders: async () => {
      calls.push("getOrders")
      return {
        ok: true,
        data: {
          orders: [],
          observedAt: 1700000000000,
        },
      }
    },
    getBalances: async () => {
      calls.push("getBalances")
      return {
        ok: true,
        data: {
          balances: [],
          sourceTime: 1700000000000,
          ageMs: 0,
          observedAt: 1700000000000,
        },
      }
    },
  }
}

test("routes all read-only keyboard actions and the balances command to their application queries", async () => {
  const calls = []
  const diagnostics = []
  const updates = [
    makeUpdate({
      updateId: 1401,
      text: "Status",
    }),
    makeUpdate({
      updateId: 1402,
      text: "Markets",
    }),
    makeUpdate({
      updateId: 1403,
      text: "Portfolio",
    }),
    makeUpdate({
      updateId: 1404,
      text: "Open Orders",
    }),
    makeUpdate({
      updateId: 1405,
      text: "/balances",
    }),
    makeCallbackUpdate({
      updateId: 1406,
      callbackId: "balance-nav-1406",
      messageId: 1406,
      data: "cc:nav:balances",
    }),
  ]
  const result = await runTelegramUpdatesForDiagnostics({
    updates,
    operator: createReadOnlyOperator({ calls }),
    logger: {
      debug: entry => diagnostics.push(entry),
      info: entry => diagnostics.push(entry),
      warn: entry => diagnostics.push(entry),
      error: entry => diagnostics.push(entry),
    },
  })
  assert.deepEqual(calls, [
    "getStatus",
    "getMarkets",
    "getPositions",
    "getOrders",
    "getBalances",
    "getBalances",
  ])
  assert.equal(result.sentMessages.length, 5)
  assert.equal(result.callbackAnswers.length, 1)
  assert.deepEqual(
    diagnostics.filter(entry => entry.message === "Telegram interaction FAILED"),
    [],
  )
})

test("restores the persistent keyboard for both /start and /menu", async () => {
  const result = await runTelegramUpdatesForDiagnostics({
    updates: [
      makeUpdate({
        updateId: 1410,
        text: "/start",
      }),
      makeUpdate({
        updateId: 1411,
        text: "/menu",
      }),
    ],
    operator: {
      pauseMarket: async () => assert.fail("Opening the menu must not invoke trading controls."),
      resumeMarket: async () => assert.fail("Opening the menu must not invoke trading controls."),
    },
  })
  assert.equal(result.sentMessages.length, 2)
  for (const message of result.sentMessages) {
    assert.equal(message.reply_markup.is_persistent, true)
    assert.equal(message.reply_markup.one_time_keyboard, false)
    assert.ok(Array.isArray(message.reply_markup.keyboard))
  }
})

test("shows an explicit empty state when no enabled market can be paused", async () => {
  const result = await runTelegramUpdatesForDiagnostics({
    updates: [
      makeUpdate({
        updateId: 1412,
        text: "Pause",
      }),
    ],
    operator: {
      pauseMarket: async () => assert.fail("An empty market selection must not invoke pauseMarket."),
      getMarkets: async () => ({
        ok: true,
        data: {
          markets: [],
        },
      }),
    },
  })
  assert.match(result.sentMessages[0].text, /No enabled markets are currently available to pause/)
  const buttons = result.sentMessages[0].reply_markup.inline_keyboard.flat()
  assert.equal(buttons.some(button => button.callback_data?.startsWith("cc:ask:")), false)
})

test("preserves a thrown market-query failure in one correlated diagnostic", async () => {
  const internalCause = new TypeError("engine market snapshot unavailable")
  const queryError = Object.assign(
    new Error("Market snapshot read failed", { cause: internalCause }),
    {
      name: "OperatorQueryError",
      code: "HARVESTER_OPERATOR_MARKET_SNAPSHOT_READ_FAILED",
      context: {
        component: "harvester.operator",
        operation: "READ_MARKETS",
        symbol: "LINKUSDT",
      },
    },
  )
  const loggedErrors = []
  await runTelegramUpdatesForDiagnostics({
    updates: [
      makeUpdate({
        updateId: 1201,
        text: "Pause",
      }),
    ],
    operator: {
      pauseMarket: async () => assert.fail("A failed market-selection query must never invoke pauseMarket."),
      getMarkets: async () => {
        throw queryError
      },
    },
    logger: {
      error: entry => loggedErrors.push(entry),
    },
  })
  assert.equal(loggedErrors.length, 1)
  assert.equal(loggedErrors[0].message, "Telegram interaction FAILED")
  assert.equal(loggedErrors[0].correlationId, "telegram:1201")
  assert.equal(loggedErrors[0].operation, "getMarkets")
  assert.equal(loggedErrors[0].errorName, "OperatorQueryError")
  assert.equal(loggedErrors[0].errorCode, "HARVESTER_OPERATOR_MARKET_SNAPSHOT_READ_FAILED")
  assert.equal(loggedErrors[0].errorMessage, "Market snapshot read failed")
  assert.equal(loggedErrors[0].errorCause.message, internalCause.message)
})

test("logs an application-returned pause failure with operation and market context", async () => {
  const controlError = Object.assign(
    new Error("operator pause transition rejected"),
    {
      name: "OperatorControlError",
      code: "OPERATOR_PAUSE_TRANSITION_FAILED",
      context: {
        component: "harvester.operator",
        operation: "PAUSE_MARKET",
        symbol: "LINKUSDT",
      },
    },
  )
  const loggedErrors = []
  await runTelegramUpdatesForDiagnostics({
    updates: [
      makeUpdate({
        updateId: 1202,
        text: "/pause LINKUSDT",
      }),
    ],
    operator: {
      pauseMarket: async () => ({
        ok: false,
        errors: [controlError],
      }),
    },
    logger: {
      error: entry => loggedErrors.push(entry),
    },
  })
  assert.equal(loggedErrors.length, 1)
  assert.equal(loggedErrors[0].message, "Telegram interaction FAILED")
  assert.equal(loggedErrors[0].correlationId, "telegram:1202")
  assert.equal(loggedErrors[0].operation, "pauseMarket")
  assert.equal(loggedErrors[0].symbol, "LINKUSDT")
  assert.equal(loggedErrors[0].applicationOperationInvoked, true)
  assert.equal(loggedErrors[0].applicationOperationCompleted, false)
  assert.equal(loggedErrors[0].stateChanged, false)
  assert.equal(loggedErrors[0].errorCode, "OPERATOR_PAUSE_TRANSITION_FAILED")
})

test("distinguishes a completed pause from a failed Telegram response", async () => {
  const loggedErrors = []
  await runTelegramUpdatesForDiagnostics({
    updates: [
      makeUpdate({
        updateId: 1203,
        text: "/pause LINKUSDT",
      }),
    ],
    operator: {
      pauseMarket: async () => ({
        ok: true,
        data: {
          symbol: "LINKUSDT",
          paused: true,
          alreadyPaused: false,
          durable: false,
        },
      }),
    },
    logger: {
      error: entry => loggedErrors.push(entry),
    },
    sendMessageError: new Error("simulated Telegram send failure"),
  })
  assert.equal(loggedErrors.length, 1)
  assert.equal(loggedErrors[0].correlationId, "telegram:1203")
  assert.equal(loggedErrors[0].stage, "RESPONSE_DELIVERY")
  assert.equal(loggedErrors[0].applicationOperationInvoked, true)
  assert.equal(loggedErrors[0].applicationOperationCompleted, true)
  assert.equal(loggedErrors[0].stateChanged, true)
})

test("does not report a resume when the application confirms no operator pause existed", async () => {
  const entries = []
  const result = await runTelegramUpdatesForDiagnostics({
    updates: [
      makeUpdate({
        updateId: 1204,
        text: "/resume LINKUSDT",
      }),
    ],
    operator: {
      pauseMarket: async () => assert.fail("A resume interaction must not invoke pauseMarket."),
      resumeMarket: async () => ({
        ok: true,
        data: {
          symbol: "LINKUSDT",
          resumed: false,
          reason: "NOT_OPERATOR_PAUSED",
        },
      }),
    },
    logger: {
      debug: entry => entries.push({ ...entry,
loggedAtLevel: "debug" }),
      info: entry => entries.push({ ...entry,
loggedAtLevel: "info" }),
      error: entry => entries.push(entry),
    },
  })
  assert.match(result.sentMessages[0].text, /is not operator-paused/)
  assert.match(result.sentMessages[0].text, /No state change/)
  assert.doesNotMatch(result.sentMessages[0].text, /^Resumed LINKUSDT/)
  const updateReceived = entries.find(entry => entry.message === "Telegram update RECEIVED")
  assert.equal(updateReceived?.loggedAtLevel, "info")
  const completion = entries.find(entry => entry.message === "Telegram application operation COMPLETED")
  assert.equal(completion?.applicationOperationCompleted, true)
  assert.equal(completion?.stateChanged, false)
  assert.equal(completion?.loggedAtLevel, "info")
})

function createCallbackAckRetryFetch({ askUpdate, confirmUpdate }) {
  const updateOffsets = []
  let pollCount = 0
  let callbackAckCount = 0
  let finishThirdPoll
  const thirdPoll = new Promise(resolve => {
    finishThirdPoll = resolve
  })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") {
      return makeResponse({
        ok: true,
        result: { username: "coinzilla_bot" },
      })
    }
    if (telegramApiMethod === "setMyCommands" || telegramApiMethod === "editMessageText") {
      return makeResponse({
        ok: true,
        result: true,
      })
    }
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      updateOffsets.push(JSON.parse(telegramRequestOptions.body).offset)
      if (pollCount === 1) {
        return makeResponse({
          ok: true,
          result: [askUpdate, confirmUpdate],
        })
      }
      if (pollCount === 2) {
        return makeResponse({
          ok: true,
          result: [confirmUpdate],
        })
      }
      finishThirdPoll()
      return new Promise((...promiseArgs) => {
        const [, reject] = promiseArgs
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "answerCallbackQuery") {
      callbackAckCount += 1
      if (callbackAckCount === 2) {
        return makeResponse({
          ok: false,
          description: "Temporary Telegram acknowledgement failure",
        }, 500)
      }
      return makeResponse({
        ok: true,
        result: true,
      })
    }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  return {
    fetchImpl,
    thirdPoll,
    updateOffsets,
    get callbackAckCount() {
      return callbackAckCount
    },
  }
}

test("retains a confirmation when callback acknowledgement fails and retries the same update", async () => {
  const askUpdate = makeCallbackUpdate({
    updateId: 1301,
    callbackId: "ask-1301",
    messageId: 1301,
    data: "cc:ask:PAUSE:LINKUSDT",
  })
  const confirmUpdate = makeCallbackUpdate({
    updateId: 1302,
    callbackId: "confirm-1302",
    messageId: 1301,
    data: "cc:confirm:PAUSE:LINKUSDT:1301",
  })
  const operatorCalls = []
  const diagnostics = []
  const mock = createCallbackAckRetryFetch({
    askUpdate,
    confirmUpdate,
  })
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator: {
      pauseMarket: async request => {
        operatorCalls.push(request)
        return {
          ok: true,
          data: {
            symbol: request.symbol,
            paused: true,
            alreadyPaused: false,
          },
        }
      },
    },
    logger: {
      debug: entry => diagnostics.push(entry),
      info: entry => diagnostics.push(entry),
      warn: entry => diagnostics.push(entry),
      error: entry => diagnostics.push(entry),
    },
    fetchImpl: mock.fetchImpl,
    retryDelayMs: 1,
  })
  await adapter.start()
  await mock.thirdPoll
  await adapter.stop()
  assert.equal(mock.callbackAckCount, 3)
  assert.deepEqual(mock.updateOffsets, [undefined, 1302, 1303])
  assert.equal(operatorCalls.length, 1)
  const ackFailure = diagnostics.find(entry => entry.message === "Telegram interaction FAILED")
  assert.equal(ackFailure?.correlationId, "telegram:1302")
  assert.equal(ackFailure?.stage, "CALLBACK_ACKNOWLEDGEMENT")
  assert.equal(ackFailure?.applicationOperationInvoked, false)
  const retry = diagnostics.find(entry => entry.message === "Telegram polling retry scheduled")
  assert.equal(retry?.correlationId, "telegram:1302")
  const completion = diagnostics.find(entry => entry.message === "Telegram application operation COMPLETED")
  assert.equal(completion?.applicationOperationCompleted, true)
  assert.equal(completion?.stateChanged, true)
})



function createExpiredCallbackAcknowledgementFetch({ updates }) {
  let pollCount = 0
  let callbackAckCount = 0
  let finishSecondPoll
  const secondPoll = new Promise(resolve => {
    finishSecondPoll = resolve
  })
  const fetchImpl = async (...telegramFetchArguments) => {
    const [telegramRequestUrl, telegramRequestOptions = {}] = telegramFetchArguments
    const telegramApiMethod = telegramRequestUrl.split("/").pop()
    if (telegramApiMethod === "getMe") {
      return makeResponse({
        ok: true,
        result: { username: "coinzilla_bot" },
      })
    }
    if (telegramApiMethod === "setMyCommands" || telegramApiMethod === "editMessageText") {
      return makeResponse({
        ok: true,
        result: true,
      })
    }
    if (telegramApiMethod === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {
        return makeResponse({
          ok: true,
          result: updates,
        })
      }
      finishSecondPoll()
      return new Promise(promiseArgs => {
        const [, reject] = promiseArgs
        telegramRequestOptions.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      })
    }
    if (telegramApiMethod === "answerCallbackQuery") {
      callbackAckCount += 1
      if (callbackAckCount === 2) {
        return makeResponse({
          ok: false,
          description: "Bad Request: query is too old",
        }, 400)
      }
      return makeResponse({
        ok: true,
        result: true,
      })
    }
    throw new Error(`Unexpected Telegram API method: ${telegramApiMethod}`)
  }
  return {
    fetchImpl,
    secondPoll,
    getCallbackAckCount: () => callbackAckCount,
  }
}

test("does not consume a pending confirmation when Telegram reports an expired callback acknowledgement", async () => {
  const updates = [
    makeCallbackUpdate({
      updateId: 1501,
      messageId: 1501,
      data: "cc:ask:PAUSE:LINKUSDT",
    }),
    makeCallbackUpdate({
      updateId: 1502,
      messageId: 1501,
      data: "cc:confirm:PAUSE:LINKUSDT:1501",
    }),
    makeCallbackUpdate({
      updateId: 1503,
      messageId: 1501,
      data: "cc:confirm:PAUSE:LINKUSDT:1501",
    }),
  ]
  const operatorCalls = []
  const diagnostics = []
  const mock = createExpiredCallbackAcknowledgementFetch({ updates })
  const adapter = createTelegramOperatorAdapter({
    botToken: "test-token",
    allowedUserIds: ["12345"],
    operator: {
      pauseMarket: async request => {
        operatorCalls.push(request)
        return {
          ok: true,
          data: {
            symbol: request.symbol,
            paused: true,
            alreadyPaused: false,
          },
        }
      },
    },
    logger: {
      debug: entry => diagnostics.push(entry),
      info: entry => diagnostics.push(entry),
      warn: entry => diagnostics.push(entry),
      error: entry => diagnostics.push(entry),
    },
    fetchImpl: mock.fetchImpl,
    retryDelayMs: 1,
  })
  await adapter.start()
  await mock.secondPoll
  await adapter.stop()

  assert.equal(mock.getCallbackAckCount(), 3)
  assert.equal(operatorCalls.length, 1)
  assert.equal(operatorCalls[0].symbol, "LINKUSDT")
  const expired = diagnostics.find(entry =>
    entry.message === "Telegram callback acknowledgement EXPIRED"
      && entry.correlationId === "telegram:1502")
  assert.equal(expired?.acknowledged, false)
  const completion = diagnostics.find(entry =>
    entry.message === "Telegram application operation COMPLETED")
  assert.equal(completion?.applicationOperationCompleted, true)
  assert.equal(completion?.stateChanged, true)
})

