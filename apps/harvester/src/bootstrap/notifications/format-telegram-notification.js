const MAX_FIELD_LENGTH = 320

function text(value, fallback = "n/a", maxLength = MAX_FIELD_LENGTH) {
  if (typeof value !== "string" && typeof value !== "number") {
    return fallback
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return fallback
  }

  const normalized = String(value)
    // eslint-disable-next-line no-control-regex -- Strip control characters before sending plain text to Telegram.
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)

  return normalized || fallback
}

const QUOTE_ASSETS = ["FDUSD", "USDT", "USDC", "BUSD", "TUSD", "BTC", "ETH", "BNB", "EUR", "TRY"]

function symbol(value) {
  const normalized = text(value, "n/a", 64).toUpperCase()
  if (normalized.includes("/")) {
    return normalized
  }

  const quote = QUOTE_ASSETS.find((asset) => normalized.length > asset.length && normalized.endsWith(asset))
  const base = quote ? normalized.slice(0, -quote.length) : ""
  return quote && base && !/\s/.test(base) ? `${base}/${quote}` : normalized
}

function side(value) {
  const normalized = text(value, "UNKNOWN", 24).toUpperCase()
  return { label: normalized, icon: normalized === "BUY" ? "🟢" : normalized === "SELL" ? "🔴" : "⚪" }
}

function fillIcon(value) {
  const normalized = text(value, "", 24).toUpperCase()
  return normalized === "BUY" ? "✅" : normalized === "SELL" ? "💰" : "💰"
}

function orderId(data) {
  const id = data.brokerOrderId ?? data.orderId ?? data.clientOrderId
  return id === undefined || id === null ? null : `#${text(id, "n/a", 96)}`
}

function compactOrder(data, icon, status = "") {
  const direction = side(data.side)
  const heading = `${icon ?? direction.icon} ${direction.label} ${symbol(data.symbol)}${status ? ` ${status}` : ""}`
  const price = data.price === undefined ? null : `@ ${text(data.price, "n/a", 96)}`
  const quantity = data.quantity === undefined ? null : `× ${text(data.quantity, "n/a", 96)}`
  const facts = [price, quantity].filter(Boolean).join(" ")
  return [facts ? `${heading} ${facts}` : heading, orderId(data)].filter(Boolean).join("\n")
}

const formatters = Object.freeze({
  "order.filled": ({ data }) => compactOrder(data, fillIcon(data.side), "ORDER FILLED"),
  "fill.received": ({ data }) => {
    const fill = data.fill && typeof data.fill === "object" && !Array.isArray(data.fill) ? data.fill : {}
    const price = text(fill.price, "n/a", 96)
    const quantity = text(fill.quantity, "n/a", 96)
    const trade = fill.tradeId ?? fill.id
    return [
      `${fillIcon(data.side)} FILL RECEIVED · ${symbol(data.symbol)} @ ${price} × ${quantity}`,
      trade === undefined || trade === null ? null : `#${text(trade, "n/a", 96)}`,
    ].filter(Boolean).join("\n")
  },
  "bot.pair_paused": ({ data }) => `⚠️ ${symbol(data.symbol)} PAUSED · ${text(data.message ?? data.reason)}`,
  "bot.recovery_failed": ({ data }) => `⚠️ BOT RECOVERY FAILED · ${text(data.message ?? data.reason)}`,
  "bot.recovery_completed": ({ data }) => `✅ BOT RECOVERY COMPLETED · ${text(data.message ?? data.summary, "Recovery completed")}`,
  "bot.startup_failed": ({ data }) => `⚠️ BOT STARTUP FAILED · ${text(data.stage, "n/a", 64)} · ${text(data.error?.message ?? data.message)}`,
  "broker.connected": ({ data }) => [
    `🟩 BROKER CONNECTED · ${text(data.broker, "UNKNOWN", 64).toUpperCase()}`,
    ...(data.tradingMode === undefined ? [] : [text(data.tradingMode, "n/a", 24).toUpperCase()]),
  ].join(" · "),
  "broker.disconnected": ({ data }) => `🟥 ${text(data.broker, "BROKER", 64).toUpperCase()} DISCONNECTED · ${text(data.error?.message ?? data.reason ?? data.outcome)}`,
  "order.submitted": ({ data }) => compactOrder(data, null, "ORDER SUBMITTED"),
  "order.cancelled": ({ data }) => [
    `✖️ ${side(data.side).label} ${symbol(data.symbol)} ORDER CANCELLED · Filled ${text(data.executedQuantity, "0", 96)}`,
    orderId(data),
  ].filter(Boolean).join("\n"),
  "order.failed": ({ data }) => `❌ ${side(data.side).label} ${symbol(data.symbol)} FAILED · ${text(data.error?.message ?? data.message ?? data.reason)}`,
  "account.safety_alert": ({ data }) => `${data.category === "account-open-orders-blocked" ? "🚨" : "⚠️"} ACCOUNT SAFETY · ${symbol(data.symbol)} · ${text(data.category, "safety", 64)} · ${text(data.message ?? data.reason)}`,
  "bot.started": () => "▶️ BOT STARTED",
  "bot.stopped": ({ data }) => {
    const reason = data.reason ?? data.message
    const outcome = data.outcome && data.outcome !== "completed" ? data.outcome : null
    const detail = reason ?? outcome
    return detail ? `⏹️ BOT STOPPED · ${text(detail, "completed", 96)}` : "⏹️ BOT STOPPED"
  },
})

export const HARVESTER_TELEGRAM_NOTIFICATION_EVENTS = Object.freeze(Object.keys(formatters))

/**
 * Format one explicitly supported event into bounded, plain-text Telegram content.
 * Only named fields are included; raw exchange payloads and arbitrary fields are ignored.
 */
export function formatHarvesterTelegramNotification(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("event must be an object")
  }
  if (typeof event.name !== "string") {
    throw new TypeError("event.name must be a string")
  }
  if (!Object.hasOwn(formatters, event.name)) {
    return null
  }

  const data = event.data && typeof event.data === "object" && !Array.isArray(event.data)
    ? event.data
    : {}

  return formatters[event.name]({ ...event, data })
}

