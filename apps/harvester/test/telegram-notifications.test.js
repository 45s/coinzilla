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
  return startMain({ acquireProcessLock: async () => ({ ok: true, release: async () => ({ ok: true }) }), createOperationalStateStore: () => ({ verify: async () => ({ ok: true, data: { valid: true, durableWriteSupported: true } }) }), ...rest, env: { TRADING_MODE: "testnet", ...env } })
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
          side: "BUY",
          price: "0.075",
          quantity: "400",
          tradeId: "trade-123",
        },
      })
      eventPublisher.publish({
        name: "execution.fill_applied",
        source: "harvester",
        data: {
          symbol: "DOGEUSDT",
          side: "SELL",
          price: "0.076",
          quantity: "399",
          tradeId: "trade-124",
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

  assert.equal(sentMessages.length, 6, "Telegram must receive startup, pause, canonical fill, recovery completion, and shutdown notifications")
  assert.ok(sentMessages.includes("🚀 BOT STARTED"), "A successful Harvester startup must use the selected start icon")
  assert.ok(sentMessages.includes("⏸️ DOGE/USDT PAUSED · accounting safety halt"), "A market pause must render the exact selected pause icon and preserve its reason")
  assert.ok(sentMessages.includes("✔️ FILL RECEIVED · DOGE/USDT @ 0.075 × 400\n#trade-123"), "A canonical BUY fill must retain its side and render the selected BUY-fill icon")
  assert.ok(sentMessages.includes("💸 FILL RECEIVED · DOGE/USDT @ 0.076 × 399\n#trade-124"), "A canonical SELL fill must retain its side and render the selected SELL-fill icon")
  assert.ok(sentMessages.includes("💰 BOT RECOVERY COMPLETED · DOGEUSDT recovery completed; net profit 0.25; retained quantity 1"), "A completed recovery cycle must render the selected money-bag icon")
  assert.ok(sentMessages.some((message) => message.startsWith("🔒 BOT STOPPED")), "A confirmed Harvester shutdown must render the selected lock icon")
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
  const loggerInfos = []
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
        info(entry) { loggerInfos.push(entry) },
        error(entry) { loggerErrors.push(entry) },
      },
    })

    await signalHandlers.get("SIGTERM")()
    assert.equal(process.exitCode, 0, "Telegram transport failure must not change Harvester's shutdown result")
    const deliveryFailure = loggerErrors.find((entry) => entry.message === "Telegram notification delivery failed")
    assert.ok(deliveryFailure, "A Telegram delivery failure must remain visible in the application logger.")
    assert.equal(deliveryFailure.notificationDiagnostics.failedCount, 1, "Failure logs must include delivery counters after the failed send.")
    const deliverySummary = loggerInfos.find((entry) => entry.message === "Telegram notification delivery summary")
    assert.equal(deliverySummary.failedCount, 2, "Shutdown must report every failed API send, including the final stop notification.")
    assert.equal(deliverySummary.pendingCount, 0, "The final delivery summary must be captured after accepted sends drain.")
    assert.equal(deliverySummary.closed, true, "The final delivery summary must confirm the subscriber is closed.")
  } finally {
    process.exitCode = previousExitCode
  }
})


test("applies custom Telegram event overrides and market filters while preserving safety alerts", async () => {
  const sentMessages = []
  const signalHandlers = new Map()
  const config = {
    notifications: {
      telegram: {
        enabled: true,
        profile: "custom",
        markets: ["LINKUSDT"],
        events: {
          fillReceived: true,
          pairPaused: false,
          recoveryCompleted: false,
        },
      },
    },
  }

  await runMain({
    env: {
      TELEGRAM_BOT_TOKEN: "test-telegram-token",
      TELEGRAM_CHAT_ID: "test-chat-id",
    },
    loadConfig: async () => config,
    createTelegramNotifier: () => ({
      async sendMessage(message) { sentMessages.push(message) },
    }),
    createJournalService: disabledJournalService,
    start: async ({ eventPublisher }) => {
      eventPublisher.publish({
        name: "strategy.paused",
        source: "harvester",
        data: { symbol: "ETHUSDT", reason: "account safety halt" },
      })
      eventPublisher.publish({
        name: "execution.fill_applied",
        source: "harvester",
        data: { symbol: "LINKUSDT", side: "BUY", price: "14.25", quantity: "2", tradeId: "link-fill" },
      })
      eventPublisher.publish({
        name: "execution.fill_applied",
        source: "harvester",
        data: { symbol: "ETHUSDT", side: "SELL", price: "2500", quantity: "0.1", tradeId: "eth-fill" },
      })
      eventPublisher.publish({
        name: "recovery.cycle_completed",
        source: "harvester",
        data: { symbol: "LINKUSDT", realizedNetProfit: "0.42", freeQuantity: "0.01" },
      })
      eventPublisher.publish({
        name: "account.open_orders_captured",
        source: "harvester",
        data: {
          phase: "PREFLIGHT",
          observedAt: 0,
          readiness: "BLOCKED",
          orderCount: 1,
          orders: [{ symbol: "ETHUSDT" }],
          blockReasons: ["unowned open order"],
        },
      })

      return {
        connected: true,
        brokerName: "binance",
        tradingEnabled: true,
        strategyMode: "conservative",
        subscriptions: ["LINKUSDT", "ETHUSDT"],
        stop: async () => ({ ok: true }),
      }
    },
    registerSignalHandler: (signal, handler) => signalHandlers.set(signal, handler),
    logger: { info() {}, error() {} },
  })

  await signalHandlers.get("SIGTERM")()

  assert.equal(
    sentMessages.length,
    3,
    "Custom policy must deliver the selected LINK fill and both non-disableable safety alerts, while excluding the filtered ETH fill and disabled recovery summary.",
  )
  assert.ok(
    sentMessages.some((message) => message.includes("FILL RECEIVED") && message.includes("LINK/USDT") && message.includes("link-fill")),
    "The enabled fillReceived override must deliver fills for the selected LINKUSDT market.",
  )
  assert.ok(
    sentMessages.some((message) => message.includes("PAUSED") && message.includes("ETH/USDT")),
    "A critical pair-pause alert must bypass both an explicit false override and the LINKUSDT-only market filter.",
  )
  assert.ok(
    sentMessages.some((message) => message.includes("🚨 ACCOUNT SAFETY") && message.includes("ETH/USDT")),
    "An execution-accounting safety alert must bypass custom event exclusions and market filters.",
  )
  assert.ok(
    sentMessages.every((message) => !message.includes("eth-fill") && !message.includes("0.42")),
    "Ordinary filtered fills and explicitly disabled recovery-completion messages must not reach Telegram.",
  )
})

test("does not construct Telegram transport when the unified config disables notifications", async () => {
  let notifierCreations = 0

  await runMain({
    env: {
      TELEGRAM_BOT_TOKEN: "test-telegram-token",
      TELEGRAM_CHAT_ID: "test-chat-id",
    },
    loadConfig: async () => ({
      notifications: { telegram: { enabled: false, profile: "trader" } },
    }),
    createTelegramNotifier: () => {
      notifierCreations += 1
      throw new Error("Disabled Telegram notifications must not construct a transport")
    },
    createJournalService: disabledJournalService,
    start: async () => ({
      connected: true,
      brokerName: "binance",
      tradingEnabled: true,
      strategyMode: "conservative",
      subscriptions: [],
    }),
    logger: { info() {}, error() {} },
  })

  assert.equal(
    notifierCreations,
    0,
    "The config-level enabled=false switch must disable Telegram even when both credentials are present.",
  )
})


test("provides distinct minimal, trader, and verbose Telegram profile presets", async () => {
  const scenarios = [
    {
      profile: "minimal",
      expected: ["PAUSED"],
      excluded: ["BOT STARTED", "ORDER SUBMITTED", "ORDER CANCELLED", "FILL RECEIVED", "BOT RECOVERY COMPLETED", "BOT STOPPED", "BROKER CONNECTED"],
    },
    {
      profile: "trader",
      expected: ["BOT STARTED", "ORDER SUBMITTED", "ORDER CANCELLED", "FILL RECEIVED", "BOT RECOVERY COMPLETED", "PAUSED", "BOT STOPPED"],
      excluded: ["BROKER CONNECTED"],
    },
    {
      profile: "verbose",
      expected: ["BOT STARTED", "ORDER SUBMITTED", "ORDER CANCELLED", "FILL RECEIVED", "BOT RECOVERY COMPLETED", "PAUSED", "BOT STOPPED", "BROKER CONNECTED"],
      excluded: [],
    },
  ]

  for (const scenario of scenarios) {
    const sentMessages = []
    const signalHandlers = new Map()
    await runMain({
      env: { TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_CHAT_ID: "test-chat" },
      loadConfig: async () => ({ notifications: { telegram: { enabled: true, profile: scenario.profile } } }),
      createTelegramNotifier: () => ({ async sendMessage(message) { sentMessages.push(message) } }),
      createJournalService: disabledJournalService,
      start: async ({ eventPublisher }) => {
        eventPublisher.publish({ name: "broker.connected", source: "harvester", data: { broker: "binance" } })
        eventPublisher.publish({
          name: "order.submitted",
          source: "harvester",
          data: { symbol: "LINKUSDT", side: "BUY", price: "14.25", quantity: "2", brokerOrderId: "42", clientOrderId: "client-42" },
        })
        eventPublisher.publish({
          name: "order.cancelled",
          source: "harvester",
          data: { symbol: "LINKUSDT", side: "SELL", brokerOrderId: "43", clientOrderId: "client-43", executedQuantity: "0" },
        })
        eventPublisher.publish({
          name: "execution.fill_applied",
          source: "harvester",
          data: { symbol: "LINKUSDT", side: "BUY", price: "14.25", quantity: "2", tradeId: "profile-fill" },
        })
        eventPublisher.publish({
          name: "recovery.cycle_completed",
          source: "harvester",
          data: { symbol: "LINKUSDT", realizedNetProfit: "0.42", freeQuantity: "0.01" },
        })
        eventPublisher.publish({
          name: "strategy.paused",
          source: "harvester",
          data: { symbol: "LINKUSDT", reason: "safety pause" },
        })
        return {
          connected: true,
          brokerName: "binance",
          tradingEnabled: true,
          strategyMode: "conservative",
          subscriptions: ["LINKUSDT"],
          stop: async () => ({ ok: true }),
        }
      },
      registerSignalHandler: (signal, handler) => signalHandlers.set(signal, handler),
      logger: { info() {}, error() {} },
    })
    await signalHandlers.get("SIGTERM")()

    for (const expected of scenario.expected) {
      assert.ok(
        sentMessages.some((message) => message.includes(expected)),
        `The ${scenario.profile} profile must include its expected ${expected} notification.`,
      )
    }
    for (const excluded of scenario.excluded) {
      assert.equal(
        sentMessages.some((message) => message.includes(excluded)),
        false,
        `The ${scenario.profile} profile must exclude its non-selected ${excluded} notification.`,
      )
    }
  }
})


test("delivers startup, broker, order, and execution safety failures in custom mode", async () => {
  const sentMessages = []
  const signalHandlers = new Map()

  await runMain({
    env: { TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_CHAT_ID: "test-chat" },
    loadConfig: async () => ({
      notifications: {
        telegram: {
          enabled: true,
          profile: "custom",
          markets: ["LINKUSDT"],
          events: {
            startupFailed: false,
            brokerDisconnected: false,
            orderFailed: false,
            accountSafetyAlert: false,
          },
        },
      },
    }),
    createTelegramNotifier: () => ({ async sendMessage(message) { sentMessages.push(message) } }),
    createJournalService: disabledJournalService,
    start: async ({ eventPublisher }) => {
      const events = [
        ["harvester.startup_failed", { stage: "broker-connect", error: { message: "connection refused" } }],
        ["broker.connection_failed", { broker: "binance", error: { message: "socket unavailable" } }],
        ["broker.subscription_failed", { broker: "binance", stream: "market", market: "ETHUSDT", error: { message: "subscription rejected" } }],
        ["order.submission_failed", { symbol: "ETHUSDT", side: "BUY", outcome: "REJECTED", error: { message: "insufficient balance" } }],
        ["order.submission_failed", { symbol: "ETHUSDT", side: "SELL", outcome: "REJECTED", error: { message: "sell submission rejected" } }],
        ["order.cancel_failed", { symbol: "ETHUSDT", side: "BUY", outcome: "FAILED", error: { message: "buy cancel rejected" } }],
        ["order.cancel_failed", { symbol: "ETHUSDT", side: "SELL", outcome: "FAILED", error: { message: "cancel rejected" } }],
        ["execution.unowned_order", { symbol: "ETHUSDT", reason: "external order" }],
        ["execution.invalid_fill", { symbol: "ETHUSDT", reason: "invalid quantity", error: { message: "fill quantity mismatch" } }],
      ]
      for (const [name, data] of events) {
        eventPublisher.publish({ name, source: "harvester", data })
      }
      return {
        connected: true,
        brokerName: "binance",
        tradingEnabled: true,
        strategyMode: "conservative",
        subscriptions: ["LINKUSDT"],
        stop: async () => ({ ok: true }),
      }
    },
    registerSignalHandler: (signal, handler) => signalHandlers.set(signal, handler),
    logger: { info() {}, error() {} },
  })

  await signalHandlers.get("SIGTERM")()

  assert.equal(
    sentMessages.length,
    9,
    "Custom mode must deliver every critical startup, broker, order, and execution failure even when each related override is false and the symbol is outside the market filter.",
  )
  for (const [fragment, description] of [
    ["BOT STARTUP FAILED", "startup failure"],
    ["DISCONNECTED", "broker connection failure"],
    ["broker-subscription-failed", "broker subscription failure"],
    ["FAILED", "order submission/cancellation failure"],
    ["unowned-order", "unowned external order"],
    ["invalid-fill", "invalid execution fill"],
  ]) {
    assert.ok(
      sentMessages.some((message) => message.includes(fragment)),
      `The non-disableable safety policy must retain the ${description} notification.`,
    )
  }

  assert.ok(sentMessages.some((message) => message.startsWith("🛠️ BOT STARTUP FAILED")), "Startup failure must use the selected tools icon in the delivered Telegram message.")
  assert.ok(sentMessages.some((message) => message.startsWith("💤 BINANCE DISCONNECTED")), "Broker disconnection must use the selected sleep icon in the delivered Telegram message.")
  assert.ok(sentMessages.some((message) => message.startsWith("🚨 ACCOUNT SAFETY") && message.includes("broker-subscription-failed")), "Broker subscription failure must use the selected siren icon.")
  assert.ok(sentMessages.some((message) => message.startsWith("❌ BUY ETH/USDT FAILED")), "BUY submission failure must use the selected cross icon.")
  assert.ok(sentMessages.some((message) => message.startsWith("❌ SELL ETH/USDT FAILED")), "SELL submission failure must use the selected cross icon.")
  assert.ok(sentMessages.some((message) => message.startsWith("🚫 BUY ETH/USDT FAILED")), "BUY cancellation failure must use the selected prohibited icon.")
  assert.ok(sentMessages.some((message) => message.startsWith("⛔ SELL ETH/USDT FAILED")), "SELL cancellation failure must use the selected no-entry icon.")
  assert.ok(sentMessages.some((message) => message.startsWith("⚠️ ACCOUNT SAFETY") && message.includes("unowned-order")), "The undecided unowned-order alert must retain its existing warning icon.")
  assert.ok(sentMessages.some((message) => message.startsWith("⚠️ ACCOUNT SAFETY") && message.includes("invalid-fill")), "The undecided invalid-fill alert must retain its existing warning icon.")
})


test("sends readiness, reconnect, and blocked recovery alerts without notifying routine sell-through", async () => {
  const sentMessages = []
  const signalHandlers = new Map()

  await runMain({
    env: { TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_CHAT_ID: "test-chat" },
    loadConfig: async () => ({ notifications: { telegram: { enabled: true, profile: "custom", markets: ["LINKUSDT"], events: { accountSafetyAlert: false } } } }),
    createTelegramNotifier: () => ({ async sendMessage(message) { sentMessages.push(message) } }),
    createJournalService: disabledJournalService,
    start: async ({ eventPublisher }) => {
      const events = [
        ["user_data.readiness_changed", { broker: "binance", ready: false, status: "AUTHORITATIVE_RECONCILIATION_REQUIRED", trigger: "connectionClosed" }],
        ["user_data.readiness_changed", { broker: "binance", ready: true, status: "READY", trigger: "reconciled" }],
        ["broker.status_changed", { broker: "binance", stream: "user-data", status: "recovered", recoveryRequired: true }],
        ["broker.status_changed", { broker: "binance", stream: "user-data", status: "recoveryFailed", recoveryRequired: false, error: { message: "REST snapshot failed" } }],
        ["broker.status_changed", { broker: "binance", stream: "user-data", status: "recovering", recoveryRequired: true }],
        ["broker.status_changed", { broker: "binance", stream: "user-data", status: "terminated", recoveryRequired: true, error: { message: "stream closed" } }],
        ["broker.status_changed", { broker: "binance", stream: "user-data", status: "executionNormalizationFailed", recoveryRequired: false, error: { message: "invalid execution payload" } }],
        ["broker.status_changed", { broker: "binance", stream: "user-data", status: "rpcError", recoveryRequired: true, error: { message: "user-data RPC failed" } }],
        ["broker.status_changed", { broker: "binance", stream: "market-price", status: "recoveryFailed", recoveryRequired: true }],
        ["recovery.cycle_not_completed", { symbol: "ETHUSDT", marketId: "binance:ETHUSDT", sellOrderClientId: "h-ETHUSDT-sell-1", sellOrderBrokerOrderId: "123", outcome: "BLOCKED", reason: "RECOVERY_SELL_FAILED_MIN_PROFIT", realizedNetProfit: "-0.02", activeQuantity: "0.01", keepQuantity: "0.01", minProfit: "0.01" }],
        ["recovery.cycle_not_completed", { symbol: "ETHUSDT", marketId: "binance:ETHUSDT", sellOrderClientId: "h-ETHUSDT-sell-2", sellOrderBrokerOrderId: "124", outcome: "CONTINUE_SELL_THROUGH", reason: "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH", realizedNetProfit: "0", activeQuantity: "0.02", keepQuantity: "0.01", minProfit: "0.01" }],
      ]
      for (const [name, data] of events) {
        eventPublisher.publish({ name, source: "harvester", data })
      }
      return { connected: true, brokerName: "binance", tradingEnabled: true, strategyMode: "conservative", subscriptions: ["LINKUSDT"], stop: async () => ({ ok: true }) }
    },
    registerSignalHandler: (signal, handler) => signalHandlers.set(signal, handler),
    logger: { info() {}, error() {} },
  })

  await signalHandlers.get("SIGTERM")()

  assert.equal(sentMessages.length, 8, "Telegram must deliver readiness, reconnect, recovery, stream termination, normalization, RPC, and blocked-cycle alerts while suppressing routine progress.")
  assert.ok(sentMessages.some((message) => message.startsWith("🚨 USER-DATA READINESS BLOCKED") && message.includes("connectionClosed")), "A readiness loss must use the selected siren icon and explain its triggering stream status.")
  assert.ok(sentMessages.some((message) => message === "🔗 USER-DATA READY · BINANCE"), "A confirmed readiness restoration must use the selected link icon.")
  assert.ok(sentMessages.some((message) => message.startsWith("🚨 ACCOUNT SAFETY") && message.includes("user-data-reconnected-reconciliation-pending")), "A recovered transport awaiting reconciliation must use the selected siren icon.")
  assert.ok(sentMessages.some((message) => message.startsWith("🚨 ACCOUNT SAFETY") && message.includes("user-data-recovery-failed") && message.includes("REST snapshot failed")), "A failed authoritative user-data recovery must use the selected siren icon.")
  assert.ok(sentMessages.some((message) => message.startsWith("🚨 ACCOUNT SAFETY") && message.includes("user-data-stream-terminated")), "A terminated user-data stream must use the selected siren icon.")
  assert.ok(sentMessages.some((message) => message.startsWith("🚨 ACCOUNT SAFETY") && message.includes("user-data-execution-normalization-failed")), "An execution-normalization failure must use the selected siren icon.")
  assert.ok(sentMessages.some((message) => message.startsWith("🚨 ACCOUNT SAFETY") && message.includes("user-data-stream-error")), "A user-data RPC stream error must use the selected siren icon.")
  assert.equal(sentMessages.some((message) => message.includes("recovering") || message.includes("market-price")), false, "Retry progress and non-user-data status events must not create notification noise.")
  assert.ok(sentMessages.some((message) => message.startsWith("🚨 ACCOUNT SAFETY") && message.includes("recovery-cycle-blocked") && message.includes("RECOVERY_SELL_FAILED_MIN_PROFIT")), "The undecided blocked recovery alert must retain its existing siren icon.")
  assert.equal(sentMessages.some((message) => message.includes("CONTINUE_SELL_THROUGH")), false, "Expected residual sell-through must not generate a false safety alarm.")
})
