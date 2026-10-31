import test from "node:test"
import assert from "node:assert/strict"
import { formatNotification, NOTIFICATION_EVENT_NAMES } from "./format-notification.js"

test("formats filled orders using an explicit safe field allowlist", () => {
  const message = formatNotification({
    name: "order.filled",
    data: { side: "BUY", symbol: "BTCUSDT", price: "65000", quantity: "0.1", orderId: 42, event: { apiKey: "must-not-leak" } },
  })
  assert.match(message, /ORDER FILLED/)
  assert.match(message, /BUY BTCUSDT/)
  assert.doesNotMatch(message, /must-not-leak/)
})

test("formats partial fills and handles missing nested fill data", () => {
  assert.match(formatNotification({ name: "fill.received", data: { symbol: "ETHUSDT", fill: { price: 2, quantity: 3, tradeId: 4 } } }), /Trade: 4/)
  assert.match(formatNotification({ name: "fill.received", data: {} }), /n\/a/)
  assert.match(formatNotification({ name: "fill.received", data: { fill: { id: "fill-id" } } }), /Trade: fill-id/)
})

test("formats critical lifecycle and recovery events", () => {
  for (const name of ["bot.pair_paused", "bot.recovery_failed", "bot.recovery_completed", "bot.started", "bot.stopped"]) {
    assert.equal(typeof formatNotification({ name, data: { symbol: "BTCUSDT", message: "test" } }), "string")
  }
  assert.match(formatNotification({ name: "bot.recovery_completed", data: { summary: "synced" } }), /synced/)
  assert.match(formatNotification({ name: "bot.stopped", data: {} }), /Shutdown requested/)
})

test("returns null for events outside the allowlist, including prototype names", () => {
  for (const name of ["order.execution_report", "__proto__", "constructor", "toString"]) {
    assert.equal(formatNotification({ name, data: { event: "private" } }), null)
  }
  assert.equal(NOTIFICATION_EVENT_NAMES.includes("order.execution_report"), false)
})

test("validates event envelopes and safely defaults malformed data", () => {
  assert.throws(() => formatNotification(null), TypeError)
  assert.throws(() => formatNotification([]), TypeError)
  assert.throws(() => formatNotification({ name: 1 }), /event.name/)
  assert.equal(formatNotification({ name: "bot.started", data: [] }), "🟢 BOT STARTED")
})
