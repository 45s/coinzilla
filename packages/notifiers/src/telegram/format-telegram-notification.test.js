import test from "node:test"
import assert from "node:assert/strict"
import {
  formatTelegramNotification,
  TELEGRAM_NOTIFICATION_EVENT_NAMES,
} from "./format-telegram-notification.js"

test("formats filled orders using an explicit safe field allowlist", () => {
  const message = formatTelegramNotification({
    name: "order.filled",
    data: {
      side: "BUY",
      symbol: "BTCUSDT",
      price: "65000",
      quantity: "0.1",
      orderId: 42,
      event: { apiKey: "must-not-leak" },
    },
  })

  assert.match(message, /ORDER FILLED/)
  assert.match(message, /BUY BTCUSDT/)
  assert.doesNotMatch(message, /must-not-leak/)
})

test("formats partial fills and handles missing nested fill data", () => {
  assert.match(
    formatTelegramNotification({
      name: "fill.received",
      data: {
        symbol: "ETHUSDT",
        fill: { price: 2, quantity: 3, tradeId: 4 },
      },
    }),
    /Trade: 4/,
  )
  assert.match(formatTelegramNotification({ name: "fill.received", data: {} }), /n\/a/)
  assert.match(
    formatTelegramNotification({
      name: "fill.received",
      data: { fill: { id: "fill-id" } },
    }),
    /Trade: fill-id/,
  )
  assert.match(
    formatTelegramNotification({
      name: "fill.received",
      data: { fill: ["not", "an", "object"] },
    }),
    /Trade: n\/a/,
  )
})

test("formats critical lifecycle and recovery events", () => {
  for (const name of [
    "bot.pair_paused",
    "bot.recovery_failed",
    "bot.recovery_completed",
    "bot.started",
    "bot.stopped",
  ]) {
    assert.equal(
      typeof formatTelegramNotification({ name, data: { symbol: "BTCUSDT", message: "test" } }),
      "string",
    )
  }

  assert.match(
    formatTelegramNotification({ name: "bot.recovery_completed", data: { summary: "synced" } }),
    /synced/,
  )
  assert.match(
    formatTelegramNotification({ name: "bot.stopped", data: {} }),
    /Shutdown requested/,
  )
})

test("sanitizes control characters and bounds untrusted field lengths", () => {
  const message = formatTelegramNotification({
    name: "bot.pair_paused",
    data: {
      symbol: "BTC\nUSDT",
      message: "first line\r\n🚨 " + "x".repeat(10_000),
      stack: "must-not-leak",
    },
  })

  assert.doesNotMatch(message, /BTC\nUSDT/)
  assert.doesNotMatch(message, /\r/)
  assert.doesNotMatch(message, /must-not-leak/)
  assert.ok(message.length < 1000)
  assert.ok(message.includes("BTC USDT"))
})

test("returns null for events outside the allowlist, including prototype names", () => {
  for (const name of [
    "order.execution_report",
    "__proto__",
    "constructor",
    "toString",
  ]) {
    assert.equal(formatTelegramNotification({ name, data: { event: "private" } }), null)
  }

  assert.equal(TELEGRAM_NOTIFICATION_EVENT_NAMES.includes("order.execution_report"), false)
})

test("validates event envelopes and safely defaults malformed data", () => {
  assert.throws(() => formatTelegramNotification(null), TypeError)
  assert.throws(() => formatTelegramNotification([]), TypeError)
  assert.throws(() => formatTelegramNotification({ name: 1 }), /event.name/)
  assert.equal(
    formatTelegramNotification({ name: "bot.started", data: [] }),
    "🟢 BOT STARTED",
  )
})
