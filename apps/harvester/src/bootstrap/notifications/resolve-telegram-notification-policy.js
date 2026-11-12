import { TELEGRAM_NOTIFICATION_EVENT_KEYS } from "../../domain/app-config.js"
import { HARVESTER_TELEGRAM_NOTIFICATION_EVENTS } from "./format-telegram-notification.js"

const EVENT_NAME_BY_KEY = Object.freeze({
  orderSubmitted: "order.submitted",
  orderCancelled: "order.cancelled",
  orderFailed: "order.failed",
  fillReceived: "fill.received",
  pairPaused: "bot.pair_paused",
  recoveryCompleted: "bot.recovery_completed",
  recoveryFailed: "bot.recovery_failed",
  botStarted: "bot.started",
  botStopped: "bot.stopped",
  startupFailed: "bot.startup_failed",
  brokerConnected: "broker.connected",
  brokerDisconnected: "broker.disconnected",
  accountSafetyAlert: "account.safety_alert",
})

const SAFETY_EVENT_NAMES = Object.freeze([
  "bot.startup_failed",
  "broker.disconnected",
  "order.failed",
  "bot.pair_paused",
  "bot.recovery_failed",
  "account.safety_alert",
])
const NON_DISABLEABLE_EVENT_NAMES = Object.freeze([...SAFETY_EVENT_NAMES, "bot.user_data_ready"])
const NON_DISABLEABLE_EVENT_SET = new Set(NON_DISABLEABLE_EVENT_NAMES)

const PROFILE_EVENT_NAMES = Object.freeze({
  minimal: SAFETY_EVENT_NAMES,
  trader: Object.freeze([
    "bot.started",
    "bot.stopped",
    "order.submitted",
    "order.cancelled",
    "fill.received",
    "bot.recovery_completed",
    ...SAFETY_EVENT_NAMES,
  ]),
  verbose: HARVESTER_TELEGRAM_NOTIFICATION_EVENTS,
  custom: Object.freeze([]),
})

/**
 * Resolve the Harvester-owned Telegram profile, event overrides, and market filter.
 * Safety alerts and confirmed readiness restoration bypass profile exclusions, explicit false overrides, and market filters.
 */
export function resolveTelegramNotificationPolicy({ telegramConfig = {} } = {}) {
  const profile = telegramConfig.profile ?? "trader"
  const selectedEvents = new Set(PROFILE_EVENT_NAMES[profile] ?? PROFILE_EVENT_NAMES.trader)

  for (const eventKey of TELEGRAM_NOTIFICATION_EVENT_KEYS) {
    const eventName = EVENT_NAME_BY_KEY[eventKey]
    const override = telegramConfig.events?.[eventKey]
    if (override === true) selectedEvents.add(eventName)
    if (override === false) selectedEvents.delete(eventName)
  }

  for (const eventName of NON_DISABLEABLE_EVENT_NAMES) selectedEvents.add(eventName)

  const markets = Object.freeze([...(telegramConfig.markets ?? [])])
  const eventNames = Object.freeze(
    HARVESTER_TELEGRAM_NOTIFICATION_EVENTS.filter((eventName) =>
      selectedEvents.has(eventName) || eventName === "bot.stopped"
    ),
  )

  return Object.freeze({
    enabled: telegramConfig.enabled !== false,
    profile,
    markets,
    eventNames,
    shouldNotify({ name, data = {} } = {}) {
      if (NON_DISABLEABLE_EVENT_SET.has(name)) return true
      if (name === "bot.stopped" && data.outcome === "failed") return true
      if (!selectedEvents.has(name)) return false
      if (markets.length > 0 && typeof data.symbol === "string" && !markets.includes(data.symbol)) return false
      return true
    },
  })
}
