import nodeTest from "node:test"
import assert from "node:assert/strict"
import {
  createTelegramOperatorAdapter,
  parseTelegramOperatorCommand,
} from "./telegram-operator-adapter.js"

const test = nodeTest

function makeResponse({ payload, status = 200 }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

function makeUpdate({ updateId = 100, userId = 12345, text = "/start" } = {}) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1700000000,
      from: {
        id: userId,
        is_bot: false,
      },
      chat: {
        id: userId,
        type: "private",
      },
      text,
    },
  }
}

function makeMarket({ symbol, enabled, operatorPaused }) {
  return {
    symbol,
    enabled,
    readiness: enabled ? "READY" : "DISABLED",
    latestPrice: enabled ? "10" : null,
    priceFresh: enabled,
    operatorPaused,
    blockers: [],
  }
}

function createFetchMock({ updates, sentMessages, registeredCommands }) {
  let pollCount = 0
  let finishSecondPoll
  const secondPoll = new Promise((resolve) => {
    finishSecondPoll = resolve
  })
  const fetchImpl = async (...args) => {
    const [url, options = {}] = args
    const method = url.split("/").pop()
    if (method === "getMe") {
      return makeResponse({
        payload: {
          ok: true,
          result: {
            id: 99,
            username: "coinzilla_bot",
          },
        },
      })
    }
    if (method === "setMyCommands") {
      registeredCommands.push(JSON.parse(options.body))
      return makeResponse({
        payload: {
          ok: true,
          result: true,
        },
      })
    }
    if (method === "getUpdates") {
      pollCount += 1
      if (pollCount === 1) {
        return makeResponse({
          payload: {
            ok: true,
            result: updates,
          },
        })
      }
      finishSecondPoll()
      const abortPoll = (...settlers) => {
        const [, reject] = settlers
        if (options.signal.aborted) {
          reject(new Error("poll aborted"))
          return
        }
        options.signal.addEventListener("abort", () => reject(new Error("poll aborted")), { once: true })
      }
      return new Promise(abortPoll)
    }
    if (method === "sendMessage") {
      sentMessages.push(JSON.parse(options.body))
      return makeResponse({
        payload: {
          ok: true,
          result: {
            message_id: 200,
          },
        },
      })
    }
    if (method === "answerCallbackQuery") {
      return makeResponse({
        payload: {
          ok: true,
          result: true,
        },
      })
    }
    throw new Error(`Unexpected Telegram API method: ${method}`)
  }
  return {
    fetchImpl,
    secondPoll,
  }
}

async function runAdapter({ updates, operator } = {}) {
  const sentMessages = []
  const registeredCommands = []
  const { fetchImpl, secondPoll } = createFetchMock({
    updates,
    sentMessages,
    registeredCommands,
  })
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
  return {
    sentMessages,
    registeredCommands,
  }
}

test("parses the six persistent keyboard labels as existing Command Center actions", () => {
  const buttonActions = [
    {
      label: "Pause",
      expected: { type: "PAUSE_MENU" },
    },
    {
      label: "Resume",
      expected: { type: "RESUME_MENU" },
    },
    {
      label: "Status",
      expected: { type: "STATUS" },
    },
    {
      label: "Markets",
      expected: { type: "MARKETS" },
    },
    {
      label: "Portfolio",
      expected: { type: "POSITIONS" },
    },
    {
      label: "Open Orders",
      expected: { type: "ORDERS" },
    },
  ]

  for (const { label, expected } of buttonActions) {
    assert.deepEqual(
      parseTelegramOperatorCommand(label),
      expected,
      `The persistent keyboard label ${label} must resolve to its existing Command Center action.`,
    )
  }
  assert.deepEqual(
    parseTelegramOperatorCommand("ordinary chat text"),
    { type: "IGNORE" },
    "Unrecognized ordinary text must remain ignored rather than becoming an arbitrary operator command.",
  )
})

test("parses start, menu and help as separate Telegram entry points", () => {
  assert.deepEqual(
    parseTelegramOperatorCommand("/start"),
    { type: "START" },
    "The /start command must open the persistent Command Center keyboard.",
  )
  assert.deepEqual(
    parseTelegramOperatorCommand("/menu"),
    { type: "MENU" },
    "The /menu command must restore the persistent keyboard when a user hides it.",
  )
  assert.deepEqual(
    parseTelegramOperatorCommand("/help"),
    { type: "HELP" },
    "The /help command must remain a text-only command reference.",
  )
})

test("opens and restores the persistent six-button keyboard through start and menu commands", async () => {
  const updates = [
    makeUpdate({
      updateId: 101,
      text: "/start",
    }),
    makeUpdate({
      updateId: 102,
      text: "/menu",
    }),
  ]
  const { sentMessages, registeredCommands } = await runAdapter({
    updates,
    operator: {
      pauseMarket: async () => assert.fail("Opening the Telegram menu must never invoke a trading control use case."),
    },
  })

  assert.equal(
    sentMessages.length,
    2,
    "Both /start and /menu must return one Command Center message with the persistent keyboard.",
  )
  for (const sentMessage of sentMessages) {
    assert.deepEqual(
      sentMessage.reply_markup,
      {
        keyboard: [
          [
            { text: "Pause" },
            { text: "Resume" },
          ],
          [
            { text: "Status" },
            { text: "Markets" },
          ],
          [
            { text: "Portfolio" },
            { text: "Open Orders" },
          ],
        ],
        is_persistent: true,
        resize_keyboard: true,
        one_time_keyboard: false,
        input_field_placeholder: "Command Center",
      },
      "The main menu must use Telegram's persistent reply keyboard with the six approved actions.",
    )
  }
  assert.ok(
    registeredCommands[0].commands.some((command) => command.command === "menu"),
    "The Telegram command menu must expose /menu so the persistent keyboard can be restored after it is hidden.",
  )
})

test("Pause opens only eligible pause choices and never pauses a market without confirmation", async () => {
  const updates = [
    makeUpdate({
      updateId: 201,
      text: "Pause",
    }),
  ]
  const marketQueries = []
  const { sentMessages } = await runAdapter({
    updates,
    operator: {
      pauseMarket: async () => assert.fail("Selecting Pause must not execute a market pause before inline confirmation."),
      getMarkets: async (request) => {
        marketQueries.push(request)
        return {
          ok: true,
          data: {
            markets: [
              makeMarket({
                symbol: "LINKUSDT",
                enabled: true,
                operatorPaused: false,
              }),
              makeMarket({
                symbol: "BTCUSDT",
                enabled: true,
                operatorPaused: true,
              }),
              makeMarket({
                symbol: "ADAUSDT",
                enabled: false,
                operatorPaused: false,
              }),
            ],
          },
        }
      },
    },
  })

  assert.equal(marketQueries.length, 1, "The Pause keyboard action must use the existing authorized markets query exactly once.")
  assert.equal(sentMessages.length, 1, "Selecting Pause must return one market-selection message.")
  assert.equal(
    sentMessages[0].reply_markup.inline_keyboard.at(-1)[0].callback_data,
    "cc:refresh:pause",
    "Refreshing a Pause selection must preserve the pause-only market filter.",
  )
  const buttons = sentMessages[0].reply_markup.inline_keyboard.flat()
  assert.deepEqual(
    buttons.filter((button) => button.callback_data?.startsWith("cc:ask:")).map((button) => button.callback_data),
    ["cc:ask:PAUSE:LINKUSDT"],
    "The Pause page must offer confirmation requests only for enabled markets that are not already operator-paused.",
  )
})

test("Resume opens only currently operator-paused markets and never resumes before confirmation", async () => {
  const updates = [
    makeUpdate({
      updateId: 202,
      text: "Resume",
    }),
  ]
  const marketQueries = []
  const { sentMessages } = await runAdapter({
    updates,
    operator: {
      pauseMarket: async () => assert.fail("Selecting Resume must not execute a market pause."),
      resumeMarket: async () => assert.fail("Selecting Resume must not execute a resume before inline confirmation."),
      getMarkets: async (request) => {
        marketQueries.push(request)
        return {
          ok: true,
          data: {
            markets: [
              makeMarket({
                symbol: "LINKUSDT",
                enabled: true,
                operatorPaused: false,
              }),
              makeMarket({
                symbol: "BTCUSDT",
                enabled: true,
                operatorPaused: true,
              }),
              makeMarket({
                symbol: "ADAUSDT",
                enabled: false,
                operatorPaused: true,
              }),
            ],
          },
        }
      },
    },
  })

  assert.equal(marketQueries.length, 1, "The Resume keyboard action must use the existing authorized markets query exactly once.")
  assert.equal(sentMessages.length, 1, "Selecting Resume must return one market-selection message.")
  assert.equal(
    sentMessages[0].reply_markup.inline_keyboard.at(-1)[0].callback_data,
    "cc:refresh:resume",
    "Refreshing a Resume selection must preserve the resume-only market filter.",
  )
  const buttons = sentMessages[0].reply_markup.inline_keyboard.flat()
  assert.deepEqual(
    buttons.filter((button) => button.callback_data?.startsWith("cc:ask:")).map((button) => button.callback_data),
    ["cc:ask:RESUME:BTCUSDT"],
    "The Resume page must offer confirmation requests only for enabled markets that are currently operator-paused.",
  )
})

function createReadOnlyOperator({ methods, actorIds }) {
  const snapshots = {
    status: {
      runtimeState: "RUNNING",
      readiness: {
        state: "READY",
        blockers: [],
      },
      userData: {
        ready: true,
        status: "READY",
        ageMs: 0,
      },
      markets: {
        enabled: 1,
        configured: 1,
        blocked: 0,
      },
      observedAt: 1700000000,
    },
    markets: {
      markets: [],
      observedAt: 1700000000,
    },
    positions: {
      positions: [],
      observedAt: 1700000000,
    },
    orders: {
      orders: [],
      observedAt: 1700000000,
    },
  }
  const readQuery = (method) => async ({ actor }) => {
    methods.push(method)
    actorIds.push(actor.id)
    return {
      ok: true,
      data: snapshots[method],
    }
  }
  return {
    pauseMarket: async () => assert.fail("Read-only keyboard actions must never invoke pauseMarket."),
    getStatus: readQuery("status"),
    getMarkets: readQuery("markets"),
    getPositions: readQuery("positions"),
    getOrders: readQuery("orders"),
  }
}

test("routes Status, Markets, Portfolio and Open Orders through existing read-only queries", async () => {
  const updates = [
    makeUpdate({
      updateId: 301,
      text: "Status",
    }),
    makeUpdate({
      updateId: 302,
      text: "Markets",
    }),
    makeUpdate({
      updateId: 303,
      text: "Portfolio",
    }),
    makeUpdate({
      updateId: 304,
      text: "Open Orders",
    }),
  ]
  const methods = []
  const actorIds = []
  const { sentMessages } = await runAdapter({
    updates,
    operator: createReadOnlyOperator({
      methods,
      actorIds,
    }),
  })

  assert.deepEqual(
    methods,
    ["status", "markets", "positions", "orders"],
    "Each read-only button must dispatch to its existing application query in the expected order.",
  )
  assert.deepEqual(
    sentMessages.map((message) => message.text.split("\n")[0]),
    ["Harvester status", "Harvester markets", "Harvester positions", "Harvester orders"],
    "Each button must render the corresponding existing Command Center page.",
  )
  assert.deepEqual(
    actorIds,
    [
      "telegram-user:12345",
      "telegram-user:12345",
      "telegram-user:12345",
      "telegram-user:12345",
    ],
    "Every button must use the authenticated Telegram operator actor.",
  )
})

test("rejects an unauthorized persistent-keyboard action before reading market state", async () => {
  const updates = [
    makeUpdate({
      updateId: 203,
      userId: 99999,
      text: "Pause",
    }),
  ]
  const marketQueries = []
  const { sentMessages } = await runAdapter({
    updates,
    operator: {
      pauseMarket: async () => assert.fail("An unauthorized keyboard action must never reach a control use case."),
      getMarkets: async (request) => {
        marketQueries.push(request)
        return {
          ok: true,
          data: {
            markets: [],
          },
        }
      },
    },
  })

  assert.deepEqual(marketQueries, [], "An unauthorized keyboard action must not read protected operator market state.")
  assert.equal(sentMessages[0].text, "Not authorized.", "An unauthorized keyboard action must receive the existing authorization response.")
})

test("TEMPORARY: report ESLint findings for the complete Harvester infrastructure directory", async (t) => {
  const { ESLint } = await import("eslint")
  const eslint = new ESLint()
  const results = await eslint.lintFiles(["src/infrastructure/**/*.js"])
  const findings = results.flatMap(({ filePath, messages }) =>
    messages.map(({ ruleId, severity, line, column, message }) => ({
      filePath,
      ruleId,
      severity,
      line,
      column,
      message,
    }))
  )
  const errorCount = findings.filter(({ severity }) => severity === 2).length
  const warningCount = findings.filter(({ severity }) => severity === 1).length
  t.diagnostic("HARVESTER_INFRASTRUCTURE_ESLINT_REPORT "+JSON.stringify({
    fileCount: results.length,
    errorCount,
    warningCount,
    findings,
  }))
})
