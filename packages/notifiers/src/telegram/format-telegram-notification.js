const MAX_FIELD_LENGTH = 320

function text(value, fallback = "n/a", maxLength = MAX_FIELD_LENGTH) {
  if (typeof value !== "string" && typeof value !== "number") return fallback
  if (typeof value === "number" && !Number.isFinite(value)) return fallback

  const normalized = String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)

  return normalized || fallback
}

const formatters = Object.freeze({
  "order.filled": ({ data }) => [
    "✅ ORDER FILLED",
    `${text(data.side, "UNKNOWN", 24).toUpperCase()} ${text(data.symbol, "n/a", 64)}`,
    `Price: ${text(data.price, "n/a", 96)}`,
    `Quantity: ${text(data.quantity, "n/a", 96)}`,
    `Order: ${text(data.orderId, "n/a", 96)}`,
  ].join("\n"),
  "fill.received": ({ data }) => {
    const fill = data.fill && typeof data.fill === "object" && !Array.isArray(data.fill)
      ? data.fill
      : {}
    return [
      "📈 EXECUTION RECEIVED",
      text(data.symbol, "n/a", 64),
      `Price: ${text(fill.price, "n/a", 96)}`,
      `Quantity: ${text(fill.quantity, "n/a", 96)}`,
      `Trade: ${text(fill.tradeId ?? fill.id, "n/a", 96)}`,
    ].join("\n")
  },
  "bot.pair_paused": ({ data }) => [
    "🛑 TRADING PAIR PAUSED",
    `Symbol: ${text(data.symbol, "n/a", 64)}`,
    `Reason: ${text(data.message ?? data.reason)}`,
  ].join("\n"),
  "bot.recovery_failed": ({ data }) => [
    "🚨 BOT RECOVERY FAILED",
    `Reason: ${text(data.message ?? data.reason)}`,
  ].join("\n"),
  "bot.recovery_completed": ({ data }) => [
    "✅ BOT RECOVERY COMPLETED",
    `Summary: ${text(data.message ?? data.summary, "Recovery completed")}`,
  ].join("\n"),
  "bot.startup_failed": ({ data }) => [
    "🚨 BOT STARTUP FAILED",
    `Stage: ${text(data.stage, "n/a", 64)}`,
    `Reason: ${text(data.error?.message ?? data.message)}`,
  ].join("\\n"),
  "broker.connected": ({ data }) => [
    "🔌 BROKER CONNECTED",
    `Broker: ${text(data.broker, "n/a", 64)}`,
    `Mode: ${text(data.tradingMode, "n/a", 24).toUpperCase()}`,
  ].join("\\n"),
  "broker.disconnected": ({ data }) => [
    "🔌 BROKER DISCONNECTED",
    `Broker: ${text(data.broker, "n/a", 64)}`,
    `Reason: ${text(data.error?.message ?? data.reason ?? data.outcome)}`,
  ].join("\\n"),
  "order.submitted": ({ data }) => [
    "📨 ORDER SUBMITTED",
    `${text(data.side, "UNKNOWN", 24).toUpperCase()} ${text(data.symbol, "n/a", 64)}`,
    `Price: ${text(data.price, "n/a", 96)}`,
    `Quantity: ${text(data.quantity, "n/a", 96)}`,
    `Order: ${text(data.brokerOrderId ?? data.orderId ?? data.clientOrderId, "n/a", 96)}`,
  ].join("\\n"),
  "order.cancelled": ({ data }) => [
    "⚪ ORDER CANCELLED",
    `${text(data.side, "UNKNOWN", 24).toUpperCase()} ${text(data.symbol, "n/a", 64)}`,
    `Order: ${text(data.brokerOrderId ?? data.orderId ?? data.clientOrderId, "n/a", 96)}`,
    `Executed: ${text(data.executedQuantity, "n/a", 96)}`,
  ].join("\\n"),
  "order.failed": ({ data }) => [
    "🚨 ORDER FAILED",
    `${text(data.side, "UNKNOWN", 24).toUpperCase()} ${text(data.symbol, "n/a", 64)}`,
    `Operation: ${text(data.operation, "n/a", 48)}`,
    `Outcome: ${text(data.outcome, "n/a", 48)}`,
    `Reason: ${text(data.error?.message ?? data.message ?? data.reason)}`,
  ].join("\\n"),
  "account.safety_alert": ({ data }) => [
    "🚨 ACCOUNT SAFETY ALERT",
    `Symbol: ${text(data.symbol, "account-wide", 64)}`,
    `Category: ${text(data.category, "safety", 64)}`,
    `Details: ${text(data.message ?? data.reason)}`,
  ].join("\\n"),
  "bot.started": () => "🟢 BOT STARTED",
  "bot.stopped": ({ data }) => [
    "⚪ BOT STOPPED",
    `Reason: ${text(data.reason ?? data.message, "Shutdown requested")}`,
  ].join("\n"),
})

export const TELEGRAM_NOTIFICATION_EVENT_NAMES = Object.freeze(
  Object.keys(formatters),
)

/**
 * Format one explicitly supported event into bounded, plain-text Telegram content.
 * Only named fields are included; raw exchange payloads and arbitrary fields are ignored.
 */
export function formatTelegramNotification(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("event must be an object")
  }
  if (typeof event.name !== "string") {
    throw new TypeError("event.name must be a string")
  }
  if (!Object.hasOwn(formatters, event.name)) return null

  const data = event.data && typeof event.data === "object" && !Array.isArray(event.data)
    ? event.data
    : {}

  return formatters[event.name]({ ...event, data })
}

// Preserve the original Telegram-only formatter export for existing consumers.
export const formatNotification = formatTelegramNotification
