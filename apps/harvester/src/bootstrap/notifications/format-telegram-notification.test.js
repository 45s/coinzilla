import test from "node:test"
import assert from "node:assert/strict"
import {
  formatHarvesterTelegramNotification,
  HARVESTER_TELEGRAM_NOTIFICATION_EVENTS,
} from "./format-telegram-notification.js"

test("formats filled orders as compact profit notifications", () => {
  assert.equal(
    formatHarvesterTelegramNotification({
      name: "order.filled",
      data: {
        side: "BUY",
        symbol: "BTCUSDT",
        price: "65000",
        quantity: "0.1",
        orderId: 42,
        event: { apiKey: "must-not-leak" },
      },
    }),
    "✅ BUY BTC/USDT ORDER FILLED @ 65000 × 0.1\n#42",
  )
  assert.equal(
    formatHarvesterTelegramNotification({
      name: "order.filled",
      data: { side: "SELL", symbol: "BTCUSDT", price: "65000", quantity: "0.1", orderId: 43 },
    }),
    "💰 SELL BTC/USDT ORDER FILLED @ 65000 × 0.1\n#43",
  )
})

test("formats execution fills and safely handles missing nested fill data", () => {
  assert.equal(
    formatHarvesterTelegramNotification({
      name: "fill.received",
      data: { symbol: "ETHUSDT", fill: { price: 2, quantity: 3, tradeId: 4 } },
    }),
    "💰 FILL RECEIVED · ETH/USDT @ 2 × 3\n#4",
    "A fill without a recognized side must retain the existing money-bag fallback icon.",
  )
  assert.equal(
    formatHarvesterTelegramNotification({
      name: "fill.received",
      data: { symbol: "LINKFDUSD", side: "BUY", fill: { price: "10.2", quantity: "2", tradeId: "buy-fill" } },
    }),
    "✔️ FILL RECEIVED · LINK/FDUSD @ 10.2 × 2\n#buy-fill",
    "A BUY fill must render the exact check-mark icon selected by the user.",
  )
  assert.equal(
    formatHarvesterTelegramNotification({
      name: "fill.received",
      data: { symbol: "LINKFDUSD", side: "SELL", fill: { price: "10.3", quantity: "1.99", tradeId: "sell-fill" } },
    }),
    "💸 FILL RECEIVED · LINK/FDUSD @ 10.3 × 1.99\n#sell-fill",
    "A SELL fill must render the exact money-with-wings icon selected by the user.",
  )
  assert.match(formatHarvesterTelegramNotification({ name: "fill.received", data: {} }), /💰 FILL RECEIVED/, "A fill without a side must keep the established fallback icon.")
  assert.match(
    formatHarvesterTelegramNotification({ name: "fill.received", data: { fill: { id: "fill-id" } } }),
    /#fill-id/,
    "The fill formatter must retain the canonical trade identifier when only the fallback fill ID is available.",
  )
  assert.doesNotMatch(
    formatHarvesterTelegramNotification({ name: "fill.received", data: { fill: ["not", "an", "object"] } }),
    /#not/,
    "Malformed array fill data must not be interpreted as an object containing a trade identifier.",
  )
})

test("uses the approved compact icon and layout for each notification type", () => {
  const examples = [
    [{ name: "order.submitted", data: { side: "BUY", symbol: "LINKUSDT", price: "14.25", quantity: "2", orderId: "42" } }, "🟢 BUY LINK/USDT ORDER SUBMITTED @ 14.25 × 2\n#42"],
    [{ name: "order.submitted", data: { side: "SELL", symbol: "LINKFDUSD", price: "14.5", quantity: "1" } }, "🔴 SELL LINK/FDUSD ORDER SUBMITTED @ 14.5 × 1"],
    [{ name: "order.cancelled", data: { side: "BUY", symbol: "LINKFDUSD", executedQuantity: "0", orderId: "43" } }, "✖️ BUY LINK/FDUSD ORDER CANCELLED · Filled 0\n#43"],
    [{ name: "broker.connected", data: { broker: "binance", tradingMode: "testnet" } }, "🟩 BROKER CONNECTED · BINANCE · TESTNET"],
    [{ name: "broker.disconnected", data: { broker: "binance", outcome: "success" } }, "💤 BINANCE DISCONNECTED · success"],
    [{ name: "bot.started", data: {} }, "🚀 BOT STARTED"],
    [{ name: "bot.stopped", data: { reason: "SIGINT" } }, "🔒 BOT STOPPED · SIGINT"],
    [{ name: "bot.stopped", data: {} }, "🔒 BOT STOPPED"],
    [{ name: "order.failed", data: { side: "BUY", symbol: "LINKUSDT", message: "insufficient balance" } }, "❌ BUY LINK/USDT FAILED · insufficient balance"],
    [{ name: "bot.pair_paused", data: { symbol: "LINKUSDT", reason: "stale price" } }, "⏸️ LINK/USDT PAUSED · stale price"],
  ]

  for (const [event, expected] of examples) {
    assert.equal(formatHarvesterTelegramNotification(event), expected, `Unexpected output for ${event.name}`)
  }
})

test("formats critical lifecycle and recovery events", () => {
  const examples = [
    ["bot.recovery_failed", { message: "reconciliation failed" }, /🚨 BOT RECOVERY FAILED · reconciliation failed/],
    ["bot.recovery_completed", { summary: "synced" }, /💰 BOT RECOVERY COMPLETED · synced/],
    ["bot.startup_failed", { stage: "broker-connect", message: "connection refused" }, /🛠️ BOT STARTUP FAILED · broker-connect · connection refused/],
    ["account.safety_alert", { symbol: "ZROFDUSD", category: "unowned-order", message: "manual order detected" }, /⚠️ ACCOUNT SAFETY · ZRO\/FDUSD · unowned-order · manual order detected/],
    ["account.safety_alert", { symbol: "ZROFDUSD", category: "account-open-orders-blocked", message: "audit blocked" }, /🚨 ACCOUNT SAFETY · ZRO\/FDUSD · account-open-orders-blocked · audit blocked/],
  ]

  for (const [name, data, expected] of examples) {
    assert.match(formatHarvesterTelegramNotification({ name, data }), expected, `The ${name} lifecycle or recovery notification must retain its documented icon and content.`)
  }
})

test("sanitizes control characters, bounds untrusted fields, and excludes unallowlisted data", () => {
  const message = formatHarvesterTelegramNotification({
    name: "bot.pair_paused",
    data: {
      symbol: "BTC\nUSDT",
      message: "first line\r\n" + "x".repeat(10_000),
      stack: "must-not-leak",
    },
  })

  assert.doesNotMatch(message, /BTC\nUSDT/)
  assert.doesNotMatch(message, /\r/)
  assert.doesNotMatch(message, /must-not-leak/)
  assert.ok(message.length < 1000)
  assert.ok(message.includes("BTC USDT PAUSED"))
})

test("returns null for events outside the allowlist, including prototype names", () => {
  for (const name of ["order.execution_report", "__proto__", "constructor", "toString"]) {
    assert.equal(formatHarvesterTelegramNotification({ name, data: { event: "private" } }), null)
  }

  assert.equal(HARVESTER_TELEGRAM_NOTIFICATION_EVENTS.includes("order.execution_report"), false)
})

test("validates event envelopes and safely defaults malformed data", () => {
  assert.throws(() => formatHarvesterTelegramNotification(null), TypeError, "A null notification envelope must be rejected before formatting.")
  assert.throws(() => formatHarvesterTelegramNotification([]), TypeError, "An array is not a valid notification envelope.")
  assert.throws(() => formatHarvesterTelegramNotification({ name: 1 }), /event.name/, "The formatter must reject a notification whose name is not a string.")
  assert.equal(formatHarvesterTelegramNotification({ name: "bot.started", data: [] }), "🚀 BOT STARTED", "Malformed array data must safely default to the selected bot-started message.")
})

test("omits unavailable broker mode and preserves failed shutdown details", () => {
  const connected = formatHarvesterTelegramNotification({ name: "broker.connected", data: { broker: "binance" } })
  assert.equal(connected, "🟩 BROKER CONNECTED · BINANCE", "Formatter-only broker-connected vocabulary must retain its existing output because it has no active bridge producer.")

  const stopped = formatHarvesterTelegramNotification({
    name: "bot.stopped",
    data: { outcome: "failed", reason: "cleanup incomplete" },
  })
  assert.equal(stopped, "🔒 BOT STOPPED · cleanup incomplete", "A failed shutdown must retain its detail while using the selected lock icon.")
})


test("formats successful user-data readiness restoration without claiming more than READY", () => {
  assert.equal(
    formatHarvesterTelegramNotification({
      name: "bot.user_data_ready",
      data: { broker: "binance", status: "READY" },
    }),
    "🔗 USER-DATA READY · BINANCE",
    "A confirmed application readiness transition must have a distinct success notification.",
  )
})


test("formats every selected active Telegram notification icon exactly", () => {
  const examples = [
    { event: { name: "bot.started", data: {} }, expectedMessage: "🚀 BOT STARTED" },
    { event: { name: "bot.stopped", data: {} }, expectedMessage: "🔒 BOT STOPPED" },
    { event: { name: "bot.startup_failed", data: { stage: "broker-connect", message: "connection refused" } }, expectedMessage: "🛠️ BOT STARTUP FAILED · broker-connect · connection refused" },
    { event: { name: "bot.pair_paused", data: { symbol: "LINKUSDT", reason: "stale price" } }, expectedMessage: "⏸️ LINK/USDT PAUSED · stale price" },
    { event: { name: "bot.user_data_ready", data: { broker: "binance" } }, expectedMessage: "🔗 USER-DATA READY · BINANCE" },
    { event: { name: "broker.disconnected", data: { broker: "binance", reason: "socket closed" } }, expectedMessage: "💤 BINANCE DISCONNECTED · socket closed" },
    { event: { name: "bot.recovery_completed", data: { message: "LINKUSDT recovery completed" } }, expectedMessage: "💰 BOT RECOVERY COMPLETED · LINKUSDT recovery completed" },
    { event: { name: "order.failed", data: { operation: "submission", side: "BUY", symbol: "LINKUSDT", message: "rejected" } }, expectedMessage: "❌ BUY LINK/USDT FAILED · rejected" },
    { event: { name: "order.failed", data: { operation: "submission", side: "SELL", symbol: "LINKUSDT", message: "rejected" } }, expectedMessage: "❌ SELL LINK/USDT FAILED · rejected" },
    { event: { name: "order.failed", data: { operation: "cancellation", side: "BUY", symbol: "LINKUSDT", message: "cancel rejected" } }, expectedMessage: "🚫 BUY LINK/USDT FAILED · cancel rejected" },
    { event: { name: "order.failed", data: { operation: "cancellation", side: "SELL", symbol: "LINKUSDT", message: "cancel rejected" } }, expectedMessage: "⛔ SELL LINK/USDT FAILED · cancel rejected" },
    { event: { name: "fill.received", data: { symbol: "LINKUSDT", side: "BUY", fill: { price: "14.25", quantity: "2", tradeId: "buy-fill" } } }, expectedMessage: "✔️ FILL RECEIVED · LINK/USDT @ 14.25 × 2\n#buy-fill" },
    { event: { name: "fill.received", data: { symbol: "LINKUSDT", side: "SELL", fill: { price: "14.5", quantity: "1", tradeId: "sell-fill" } } }, expectedMessage: "💸 FILL RECEIVED · LINK/USDT @ 14.5 × 1\n#sell-fill" },
    { event: { name: "account.safety_alert", data: { category: "broker-subscription-failed", message: "subscription failed" } }, expectedMessage: "🚨 ACCOUNT SAFETY · N/A · broker-subscription-failed · subscription failed" },
    { event: { name: "account.safety_alert", data: { category: "user-data-readiness-blocked", message: "readiness blocked" } }, expectedMessage: "🚨 USER-DATA READINESS BLOCKED · readiness blocked" },
    { event: { name: "account.safety_alert", data: { category: "user-data-reconnected-reconciliation-pending", message: "reconciliation pending" } }, expectedMessage: "🚨 ACCOUNT SAFETY · N/A · user-data-reconnected-reconciliation-pending · reconciliation pending" },
    { event: { name: "account.safety_alert", data: { category: "user-data-recovery-failed", message: "recovery failed" } }, expectedMessage: "🚨 ACCOUNT SAFETY · N/A · user-data-recovery-failed · recovery failed" },
    { event: { name: "account.safety_alert", data: { category: "user-data-stream-terminated", message: "stream terminated" } }, expectedMessage: "🚨 ACCOUNT SAFETY · N/A · user-data-stream-terminated · stream terminated" },
    { event: { name: "account.safety_alert", data: { category: "user-data-execution-normalization-failed", message: "normalization failed" } }, expectedMessage: "🚨 ACCOUNT SAFETY · N/A · user-data-execution-normalization-failed · normalization failed" },
    { event: { name: "account.safety_alert", data: { category: "user-data-stream-error", message: "stream error" } }, expectedMessage: "🚨 ACCOUNT SAFETY · N/A · user-data-stream-error · stream error" },
  ]

  for (const { event, expectedMessage } of examples) {
    assert.equal(
      formatHarvesterTelegramNotification(event),
      expectedMessage,
      `The active Telegram event ${event.name} must render the exact icon selected for its notification.`,
    )
  }
})

test("keeps the existing icons for five notifications left undecided", () => {
  const examples = [
    { event: { name: "account.safety_alert", data: { category: "recovery-cycle-blocked", message: "blocked" } }, expectedMessage: "🚨 ACCOUNT SAFETY · N/A · recovery-cycle-blocked · blocked" },
    { event: { name: "bot.recovery_failed", data: { message: "accounting failed" } }, expectedMessage: "🚨 BOT RECOVERY FAILED · accounting failed" },
    { event: { name: "account.safety_alert", data: { category: "unowned-order", message: "unowned" } }, expectedMessage: "⚠️ ACCOUNT SAFETY · N/A · unowned-order · unowned" },
    { event: { name: "account.safety_alert", data: { category: "invalid-fill", message: "invalid" } }, expectedMessage: "⚠️ ACCOUNT SAFETY · N/A · invalid-fill · invalid" },
    { event: { name: "account.safety_alert", data: { category: "account-open-orders-blocked", message: "audit blocked" } }, expectedMessage: "🚨 ACCOUNT SAFETY · N/A · account-open-orders-blocked · audit blocked" },
  ]

  for (const { event, expectedMessage } of examples) {
    assert.equal(
      formatHarvesterTelegramNotification(event),
      expectedMessage,
      `An undecided notification ${event.name} must retain its current icon until the user selects a replacement.`,
    )
  }
})
