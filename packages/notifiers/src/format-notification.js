const text = (value, fallback = "n/a") => {
  if (typeof value === "string" && value.trim() !== "") return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return fallback
}

const formatters = Object.freeze({
  "order.filled": ({ data }) => [
    "✅ ORDER FILLED",
    `${text(data.side, "UNKNOWN").toUpperCase()} ${text(data.symbol)}`,
    `Price: ${text(data.price)}`,
    `Quantity: ${text(data.quantity)}`,
    `Order: ${text(data.orderId)}`,
  ].join("\n"),
  "fill.received": ({ data }) => {
    const fill = data.fill && typeof data.fill === "object" ? data.fill : {}
    return [
      "📈 EXECUTION RECEIVED",
      text(data.symbol),
      `Price: ${text(fill.price)}`,
      `Quantity: ${text(fill.quantity)}`,
      `Trade: ${text(fill.tradeId ?? fill.id)}`,
    ].join("\n")
  },
  "bot.pair_paused": ({ data }) => [
    "🛑 TRADING PAIR PAUSED",
    `Symbol: ${text(data.symbol)}`,
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
  "bot.started": () => "🟢 BOT STARTED",
  "bot.stopped": ({ data }) => [
    "⚪ BOT STOPPED",
    `Reason: ${text(data.reason ?? data.message, "Shutdown requested")}`,
  ].join("\n"),
})

export const NOTIFICATION_EVENT_NAMES = Object.freeze(Object.keys(formatters))

/**
 * Convert a whitelisted domain event to a concise plain-text Telegram message.
 * Raw exchange payloads, stack traces, and arbitrary event fields are never forwarded.
 */
export function formatNotification(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("event must be an object")
  }
  if (typeof event.name !== "string") {
    throw new TypeError("event.name must be a string")
  }
  if (!Object.hasOwn(formatters, event.name)) return null
  const data = event.data && typeof event.data === "object" && !Array.isArray(event.data) ? event.data : {}
  return formatters[event.name]({ ...event, data })
}
