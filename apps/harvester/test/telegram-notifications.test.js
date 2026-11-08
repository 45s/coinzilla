import test from "node:test"
import assert from "node:assert/strict"
import { main } from "../src/index.js"

const disabledJournalService = () => ({
  ready: Promise.resolve({ ok: true, disabled: true }),
  status: { state: "disabled", enabled: false },
  close: async () => ({ ok: true, closed: true, disabled: true }),
})

test("sends allowlisted Harvester lifecycle, pause, fill, and recovery notifications", async () => {
  const sentMessages = []
  const signalHandlers = new Map()
  const loggerErrors = []

  await main({
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
        tradingEnabled: false,
        strategyMode: "read-only",
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
