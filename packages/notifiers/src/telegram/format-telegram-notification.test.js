import test from "node:test"
import assert from "node:assert/strict"
import {
  formatTelegramNotification,
  TELEGRAM_NOTIFICATION_EVENT_NAMES,
} from "./format-telegram-notification.js"

test("formats filled orders as compact profit notifications", () => {
  assert.equal(
    formatTelegramNotification({
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
    "💰 BUY BTC/USDT FILLED @ 65000 × 0.1\n#42",
  )
})

test("formats execution fills and safely handles missing nested fill data", () => {
  assert.equal(
    formatTelegramNotification({
      name: "fill.received",
      data: { symbol: "ETHUSDT", fill: { price: 2, quantity: 3, tradeId: 4 } },
    }),
    "💰 FILL RECEIVED · ETH/USDT @ 2 × 3\n#4",
  )
  assert.match(formatTelegramNotification({ name: "fill.received", data: {} }), /💰 FILL RECEIVED/)
  assert.match(
    formatTelegramNotification({ name: "fill.received", data: { fill: { id: "fill-id" } } }),
    /#fill-id/,
  )
  assert.doesNotMatch(
    formatTelegramNotification({ name: "fill.received", data: { fill: ["not", "an", "object"] } }),
    /#not/,
  )
})

test("uses the approved compact icon and layout for each notification type", () => {
  const examples = [
    [{ name: "order.submitted", data: { side: "BUY", symbol: "LINKUSDT", price: "14.25", quantity: "2", orderId: "42" } }, "🟢 BUY LINK/USDT @ 14.25 × 2\n#42"],
    [{ name: "order.submitted", data: { side: "SELL", symbol: "LINKFDUSD", price: "14.5", quantity: "1" } }, "🔴 SELL LINK/FDUSD @ 14.5 × 1"],
    [{ name: "order.cancelled", data: { side: "BUY", symbol: "LINKFDUSD", executedQuantity: "0", orderId: "43" } }, "✖️ BUY LINK/FDUSD CANCELLED · Filled 0\n#43"],
    [{ name: "broker.connected", data: { broker: "binance", tradingMode: "testnet" } }, "🟩 BINANCE CONNECTED · TESTNET"],
    [{ name: "broker.disconnected", data: { broker: "binance", outcome: "success" } }, "🟥 BINANCE DISCONNECTED · success"],
    [{ name: "bot.started", data: {} }, "🚀 BOT STARTED"],
    [{ name: "bot.stopped", data: { reason: "SIGINT" } }, "🔚 BOT STOPPED · SIGINT"],
    [{ name: "bot.stopped", data: {} }, "🔚 BOT STOPPED"],
    [{ name: "order.failed", data: { side: "BUY", symbol: "LINKUSDT", message: "insufficient balance" } }, "❌ BUY LINK/USDT FAILED · insufficient balance"],
    [{ name: "bot.pair_paused", data: { symbol: "LINKUSDT", reason: "stale price" } }, "⚠️ LINK/USDT PAUSED · stale price"],
  ]

  for (const [event, expected] of examples) {
    assert.equal(formatTelegramNotification(event), expected, `Unexpected output for ${event.name}`)
  }
})

test("formats critical lifecycle and recovery events", () => {
  const examples = [
    ["bot.recovery_failed", { message: "reconciliation failed" }, /⚠️ BOT RECOVERY FAILED · reconciliation failed/],
    ["bot.recovery_completed", { summary: "synced" }, /✅ BOT RECOVERY COMPLETED · synced/],
    ["bot.startup_failed", { stage: "broker-connect", message: "connection refused" }, /⚠️ BOT STARTUP FAILED · broker-connect · connection refused/],
    ["account.safety_alert", { symbol: "ZROFDUSD", category: "unowned-order", message: "manual order detected" }, /⚠️ ACCOUNT SAFETY · ZRO\/FDUSD · unowned-order · manual order detected/],
  ]

  for (const [name, data, expected] of examples) {
    assert.match(formatTelegramNotification({ name, data }), expected)
  }
})

test("sanitizes control characters, bounds untrusted fields, and excludes unallowlisted data", () => {
  const message = formatTelegramNotification({
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
    assert.equal(formatTelegramNotification({ name, data: { event: "private" } }), null)
  }

  assert.equal(TELEGRAM_NOTIFICATION_EVENT_NAMES.includes("order.execution_report"), false)
})

test("validates event envelopes and safely defaults malformed data", () => {
  assert.throws(() => formatTelegramNotification(null), TypeError)
  assert.throws(() => formatTelegramNotification([]), TypeError)
  assert.throws(() => formatTelegramNotification({ name: 1 }), /event.name/)
  assert.equal(formatTelegramNotification({ name: "bot.started", data: [] }), "🚀 BOT STARTED")
})

test("omits unavailable broker mode and preserves failed shutdown details", () => {
  const connected = formatTelegramNotification({ name: "broker.connected", data: { broker: "binance" } })
  assert.equal(connected, "🟩 BINANCE CONNECTED")

  const stopped = formatTelegramNotification({
    name: "bot.stopped",
    data: { outcome: "failed", reason: "cleanup incomplete" },
  })
  assert.equal(stopped, "🔚 BOT STOPPED · cleanup incomplete")
})
