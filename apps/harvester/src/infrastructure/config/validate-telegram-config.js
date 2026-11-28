import { NOTIFICATIONS_TG_PROFILES } from "../../../config/notifications-tg-profiles.js"
import { ConfigValidationError } from "../../domain/app-config.js"

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
const fail = ({
  path,
  expectation,
}) => { throw new ConfigValidationError(path, expectation) }
const requireRecord = ({ value, path }) => {
  if (!isRecord(value)) {
    fail({ path, expectation: "an object" })
  }
}
const requireBoolean = ({ value, path }) => {
  if (typeof value !== "boolean") {
    fail({ path, expectation: "a boolean" })
  }
}
const TELEGRAM_NOTIFICATION_PROFILES = Object.freeze(Object.values(NOTIFICATIONS_TG_PROFILES))
export const TELEGRAM_NOTIFICATION_EVENT_KEYS = Object.freeze([
  "orderSubmitted", "orderCancelled", "orderFailed", "fillReceived", "pairPaused",
  "recoveryCompleted", "recoveryFailed", "botStarted", "botStopped", "startupFailed",
  "brokerConnected", "brokerDisconnected", "accountSafetyAlert",
])

function validateTelegramNotificationMarkets({ markets,
  path }) {
  if (markets === undefined) {
    return
  }
  if (!Array.isArray(markets)) {
    fail({
      path: `${path}.markets`,
      expectation: "an array of unique non-empty market symbols",
    })
  }
  const seenMarkets = new Set()
  for (const [index, symbol] of markets.entries()) {
    if (typeof symbol !== "string" || !symbol.trim() || symbol !== symbol.trim()) {
      fail({
        path: `${path}.markets[${index}]`,
        expectation: "a non-empty trimmed market symbol",
      })
    }
    if (seenMarkets.has(symbol)) {
      fail({
        path: `${path}.markets`,
        expectation: "unique market symbols",
      })
    }
    seenMarkets.add(symbol)
  }
}

function validateTelegramNotificationEvents({ events,
  path }) {
  if (events === undefined) {
    return
  }
  requireRecord({
    value: events,
    path: `${path}.events`,
  })
  for (const [eventKey, enabled] of Object.entries(events)) {
    if (!TELEGRAM_NOTIFICATION_EVENT_KEYS.includes(eventKey)) {
      fail({
        path: `${path}.events.${eventKey}`,
        expectation: "a supported Telegram notification event key",
      })
    }
    requireBoolean({
      value: enabled,
      path: `${path}.events.${eventKey}`,
    })
  }
}

function validateTelegramNotificationConfig(config) {
  if (config.notifications === undefined) {
    return
  }
  requireRecord({
    value: config.notifications,
    path: "notifications",
  })
  const { telegram } = config.notifications
  if (telegram === undefined) {
    return
  }
  requireRecord({
    value: telegram,
    path: "notifications.telegram",
  })
  const path = "notifications.telegram"
  if (telegram.enabled !== undefined) {
    requireBoolean({
      value: telegram.enabled,
      path: `${path}.enabled`,
    })
  }
  if (telegram.profile !== undefined && !TELEGRAM_NOTIFICATION_PROFILES.includes(telegram.profile)) {
    fail({
      path: `${path}.profile`,
      expectation: "one of minimal, trader, verbose, or custom",
    })
  }
  validateTelegramNotificationMarkets({
    markets: telegram.markets,
    path,
  })
  validateTelegramNotificationEvents({
    events: telegram.events,
    path,
  })
}


function validateTelegramOperatorControlConfig(appConfig) {
  if (appConfig.operatorControl === undefined) {
    return
  }
  const path = "operatorControl"
  requireRecord({
    value: appConfig.operatorControl,
    path,
  })
  for (const key of Object.keys(appConfig.operatorControl)) {
    if (key !== "telegram") {
      fail({ path: `${path}.${key}`,
expectation: "a supported operator-control configuration field" })
    }
  }
  const { telegram } = appConfig.operatorControl
  requireRecord({
    value: telegram,
    path: `${path}.telegram`,
  })
  for (const key of Object.keys(telegram)) {
    if (key !== "enabled" && key !== "allowedUserIds") {
      fail({ path: `${path}.telegram.${key}`,
expectation: "a supported Telegram operator configuration field" })
    }
  }
  requireBoolean({
    value: telegram.enabled,
    path: `${path}.telegram.enabled`,
  })
  if (!Array.isArray(telegram.allowedUserIds)) {
    fail({
      path: `${path}.telegram.allowedUserIds`,
      expectation: "an array of unique positive decimal Telegram user IDs",
    })
  }
  const seenUserIds = new Set()
  for (const userId of telegram.allowedUserIds) {
    if (typeof userId !== "string" || !/^[1-9][0-9]*$/.test(userId) || !Number.isSafeInteger(Number(userId))) {
      fail({
        path: `${path}.telegram.allowedUserIds`,
        expectation: "canonical positive decimal Telegram user ID strings",
      })
    }
    if (seenUserIds.has(userId)) {
      fail({
        path: `${path}.telegram.allowedUserIds`,
        expectation: "unique positive decimal Telegram user IDs",
      })
    }
    seenUserIds.add(userId)
  }
}


export function validateTelegramApplicationConfig(config) {
  validateTelegramNotificationConfig(config)
  validateTelegramOperatorControlConfig(config)
  return config
}
