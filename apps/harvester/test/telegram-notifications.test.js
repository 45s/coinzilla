import test from "node:test"
import assert from "node:assert/strict"
import { main as startMain } from "../src/index.js"

const disabledJournalService = () => ({
  ready: Promise.resolve({ ok: true, disabled: true }),
  status: { state: "disabled", enabled: false },
  flush: async () => ({ ok: true, durable: true }),
  close: async () => ({ ok: true, closed: true, disabled: true }),
})

const runMain = (options = {}) => {
  const { env = {}, ...rest } = options
  return startMain({ acquireProcessLock: async () => ({ ok: true, release: async () => ({ ok: true }) }), ...rest, env: { TRADING_MODE: "testnet", ...env } })
}

const runMain = (options = {}) => {
  const { env = {}, ...rest } = options
  return startMain({ acquireProcessLock: async () => ({ ok: true, release: async () => ({ ok: true }) }), ...rest, env: { TRADING_MODE: "testnet", ...env } })
}

test("sends allowlisted Harvester lifecycle, pause, fill, and recovery notifications", async () => {
  const sentMessages = []
  const signalHandlers = new Map()
  const loggerErrors = []

  await runMain({
    env: {
      TELEGRAM_BOT_TOKEN: "test-telegram-token",
      TELEGRAM_CHAT_ID: "test-chat-id",
    },
    createTelegramNotifier: ({ token, chatId }) => {
      assert.equal(token, "test-telegram-token", "Harvester must pass the configured Telegram token to the notifier adapter")
      assert.equal(chatId, "test-chat-id", "Harvester must pass the configured Telegram chat ID to the notifier adapter")
      return {
        async sendMessage(message) {
          sentMessages.push(message)
        },
      }
    },
    createJournalService: disabledJournalService,
    start: async ({ eventPublisher }) => {
      eventPublisher.publish({
        name: "strategy.paused",
        source: "harvester",
        data: { symbol: "DOGEUSDT", reason: "accounting safety halt" },
      })
      eventPublisher.publish({
        name: "execution.fill_applied",
        source: "harvester",
        data: {
          symbol: "DOGEUSDT",
          price: "0.075",
          quantity: "400",
          tradeId: "trade-123",
        },
      })
      eventPublisher.publish({
        name: "recovery.cycle_completed",
        source: "harvester",
        data: {
          symbol: "DOGEUSDT",
          realizedNetProfit: "0.25",
          freeQuantity: "1",
        },
      })

      return {
        connected: true,
        brokerName: "binance",
        tradingEnabled: true,
        strategyMode: "conservative",
        subscriptions: ["DOGEUSDT"],
        stop: async () => ({ ok: true }),
      }
    },
    registerSignalHandler: (signal, handler) => {
      signalHandlers.set(signal, handler)
    },
    logger: {
      info() {},
      error(entry) {
        loggerErrors.push(entry)
      },
    },
  })

  await signalHandlers.get("SIGTERM")()

  assert.equal(sentMessages.length, 5, "Telegram must receive startup, pause, canonical fill, recovery completion, and shutdown notifications")
  assert.ok(sentMessages.some((message) => message.includes("BOT STARTED")), "A successful Harvester startup must produce a Telegram lifecycle notification")
  assert.ok(sentMessages.some((message) => message.includes("TRADING PAIR PAUSED") && message.includes("DOGEUSDT")), "A paused market must produce a Telegram safety notification with its symbol")
  assert.ok(sentMessages.some((message) => message.includes("EXECUTION RECEIVED") && message.includes("trade-123")), "An applied canonical fill must produce a Telegram execution notification")
  assert.ok(sentMessages.some((message) => message.includes("BOT RECOVERY COMPLETED") && message.includes("0.25")), "A completed recovery cycle must produce a Telegram completion notification")
  assert.ok(sentMessages.some((message) => message.includes("BOT STOPPED")), "A completed Harvester shutdown must produce a Telegram lifecycle notification")
  assert.deepEqual(loggerErrors, [], "Successful optional Telegram delivery must not create application error diagnostics")
})


test("keeps Harvester running when optional Telegram setup fails", async () => {
  const signalHandlers = new Map()
  const loggerErrors = []
  let startCalled = false

  const result = await runMain({
    env: {
      TELEGRAM_BOT_TOKEN: "configured-token",
      TELEGRAM_CHAT_ID: "configured-chat",
    },
    createTelegramNotifier: () => {
      throw new Error("Telegram configuration rejected")
    },
    createJournalService: disabledJournalService,
    start: async () => {
      startCalled = true
      return {
        connected: true,
        brokerName: "binance",
        tradingEnabled: true,
        strategyMode: "conservative",
        subscriptions: [],
        stop: async () => ({ ok: true }),
      }
    },
    registerSignalHandler: (signal, handler) => signalHandlers.set(signal, handler),
    logger: {
      info() {},
      error(entry) { loggerErrors.push(entry) },
    },
  })

  assert.equal(startCalled, true, "Telegram setup failure must not prevent the Harvester runtime from starting")
  assert.ok(result?.runtime, "Harvester must return its runtime when optional Telegram setup fails")
  assert.ok(loggerErrors.some((entry) => entry.message.includes("Telegram notifications could not be enabled")))
  await signalHandlers.get("SIGTERM")()
})

test("does not construct Telegram transport when credentials are absent", async () => {
  let notifierCreations = 0
  await runMain({
    env: {},
    createTelegramNotifier: () => {
      notifierCreations += 1
      throw new Error("Notifier must not be constructed without credentials")
    },
    createJournalService: disabledJournalService,
    start: async () => ({ connected: true, brokerName: "binance", tradingEnabled: true, strategyMode: "conservative", subscriptions: [] }),
    logger: { info() {}, error() {} },
  })

  assert.equal(notifierCreations, 0, "Telegram transport must remain disabled when both optional credentials are absent")
})

test("Telegram delivery failure is logged but does not fail runtime shutdown", async () => {
  const signalHandlers = new Map()
  const loggerErrors = []
  const previousExitCode = process.exitCode
  process.exitCode = 0

  try {
    await runMain({
      env: {
        TELEGRAM_BOT_TOKEN: "configured-token",
        TELEGRAM_CHAT_ID: "configured-chat",
      },
      createTelegramNotifier: () => ({
        async sendMessage() {
          throw new Error("simulated Telegram network failure")
        },
      }),
      createJournalService: disabledJournalService,
      start: async () => ({
        connected: true,
        brokerName: "binance",
        tradingEnabled: true,
        strategyMode: "conservative",
        subscriptions: [],
        stop: async () => ({ ok: true }),
      }),
      registerSignalHandler: (signal, handler) => signalHandlers.set(signal, handler),
      logger: {
        info() {},
        error(entry) { loggerErrors.push(entry) },
      },
    })

    await signalHandlers.get("SIGTERM")()
    assert.equal(process.exitCode, 0, "Telegram transport failure must not change Harvester's shutdown result")
    assert.ok(loggerErrors.some((entry) => entry.message === "Telegram notification delivery failed"))
  } finally {
    process.exitCode = previousExitCode
  }
})
