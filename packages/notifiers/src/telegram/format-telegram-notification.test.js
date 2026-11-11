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


test("formats additional operational notification events with bounded allowlisted fields", () => {
  const examples = [
    {
      name: "bot.startup_failed",
      data: { stage: "broker-connect", message: "connection refused", apiKey: "must-not-leak" },
      expected: /BOT STARTUP FAILED.*broker-connect.*connection refused/s,
    },
    {
      name: "broker.connected",
      data: { broker: "binance", tradingMode: "testnet", secret: "must-not-leak" },
      expected: /BROKER CONNECTED.*binance.*TESTNET/s,
    },
    {
      name: "broker.disconnected",
      data: { broker: "binance", reason: "socket closed", token: "must-not-leak" },
      expected: /BROKER DISCONNECTED.*binance.*socket closed/s,
    },
    {
      name: "order.submitted",
      data: { symbol: "LINKUSDT", side: "BUY", price: "14.25", quantity: "2", orderId: "42", apiKey: "must-not-leak" },
      expected: /ORDER SUBMITTED.*BUY LINKUSDT.*14.25.*2.*42/s,
    },
    {
      name: "order.cancelled",
      data: { symbol: "LINKFDUSD", side: "SELL", orderId: "43", token: "must-not-leak" },
      expected: /ORDER CANCELLED.*SELL LINKFDUSD.*43/s,
    },
    {
      name: "order.failed",
      data: { symbol: "LINKUSDT", side: "BUY", operation: "submission", message: "insufficient balance", stack: "must-not-leak" },
      expected: /ORDER FAILED.*BUY LINKUSDT.*submission.*insufficient balance/s,
    },
    {
      name: "account.safety_alert",
      data: { symbol: "ZROFDUSD", category: "unowned-order", message: "manual order detected", secret: "must-not-leak" },
      expected: /ACCOUNT SAFETY ALERT.*ZROFDUSD.*unowned-order.*manual order detected/s,
    },
  ]

  for (const example of examples) {
    const message = formatTelegramNotification(example)
    assert.match(message, example.expected, `The ${example.name} notification must include its curated operational facts.`)
    assert.doesNotMatch(message, /must-not-leak/, `The ${example.name} notification must exclude unallowlisted credentials and payload fields.`)
    assert.ok(message.length < 1000, `The ${example.name} notification must remain bounded for Telegram delivery.`)
  }

  assert.ok(
    examples.every(({ name }) => TELEGRAM_NOTIFICATION_EVENT_NAMES.includes(name)),
    "Every newly formatted operational event must appear in the exported supported-event allowlist.",
  )
})


test("omits unavailable broker mode and exposes failed shutdown outcome", () => {
  const connected = formatTelegramNotification({
    name: "broker.connected",
    data: { broker: "binance" },
  })
  assert.match(connected, /BROKER CONNECTED.*binance/s, "Broker connection messages must include the known broker name.")
  assert.doesNotMatch(connected, /Mode: n\/a/, "Broker connection messages must not invent an unavailable exchange mode.")

  const stopped = formatTelegramNotification({
    name: "bot.stopped",
    data: { outcome: "failed", reason: "cleanup incomplete" },
  })
  assert.match(stopped, /BOT STOPPED.*Outcome: failed.*cleanup incomplete/s, "Shutdown notifications must distinguish a failed cleanup outcome.")
})
