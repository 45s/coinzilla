import { NOTIFICATIONS_TG_PROFILES } from "../../config/notifications-tg-profiles.js"

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
export class ConfigValidationError extends TypeError {
  constructor(path, expected) {
    super(`Invalid app config at "${path}": expected ${expected}`)
    this.name = "ConfigValidationError"
    this.path = path
    this.expected = expected
  }
}

const fail = (path, expectation) => { throw new ConfigValidationError(path, expectation) }
const requireRecord = (value, path) => {
  if (!isRecord(value)) {
    fail(path, "an object")
  }
}
const requireBoolean = (value, path) => {
  if (typeof value !== "boolean") {
    fail(path, "a boolean")
  }
}
const requireNumber = (value, path, { min = -Infinity, exclusiveMin = false, max = Infinity, exclusiveMax = false } = {}) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "a finite number")
  }
  const validMinimum = exclusiveMin ? value > min : value >= min
  if (!validMinimum) {
    fail(path, exclusiveMin ? `a finite number greater than ${min}` : `a finite number greater than or equal to ${min}`)
  }
  const validMaximum = exclusiveMax ? value < max : value <= max
  if (!validMaximum) {
    fail(path, exclusiveMax ? `a finite number less than ${max}` : `a finite number less than or equal to ${max}`)
  }
}
const requirePrecision = (value, path) => {
  if (!Number.isInteger(value) || value < 0) {
    fail(path, "a non-negative integer")
  }
}


const TELEGRAM_NOTIFICATION_PROFILES = Object.freeze(Object.values(NOTIFICATIONS_TG_PROFILES))
export const TELEGRAM_NOTIFICATION_EVENT_KEYS = Object.freeze([
  "orderSubmitted", "orderCancelled", "orderFailed", "fillReceived", "pairPaused",
  "recoveryCompleted", "recoveryFailed", "botStarted", "botStopped", "startupFailed",
  "brokerConnected", "brokerDisconnected", "accountSafetyAlert",
])

function validateTelegramNotificationConfig(config) {
  if (config.notifications === undefined) {
    return
  }
  requireRecord(config.notifications, "notifications")
  const telegram = config.notifications.telegram
  if (telegram === undefined) {
    return
  }
  requireRecord(telegram, "notifications.telegram")
  const path = "notifications.telegram"

  if (telegram.enabled !== undefined) {
    requireBoolean(telegram.enabled, `${path}.enabled`)
  }
  if (telegram.profile !== undefined && !TELEGRAM_NOTIFICATION_PROFILES.includes(telegram.profile)) {
    fail(`${path}.profile`, "one of minimal, trader, verbose, or custom")
  }
  if (telegram.markets !== undefined) {
    if (!Array.isArray(telegram.markets)) {
      fail(`${path}.markets`, "an array of unique non-empty market symbols")
    }
    const seenMarkets = new Set()
    for (const [index, symbol] of telegram.markets.entries()) {
      if (typeof symbol !== "string" || !symbol.trim() || symbol !== symbol.trim()) {
        fail(`${path}.markets[${index}]`, "a non-empty trimmed market symbol")
      }
      if (seenMarkets.has(symbol)) {
        fail(`${path}.markets`, "unique market symbols")
      }
      seenMarkets.add(symbol)
    }
  }
  if (telegram.events !== undefined) {
    requireRecord(telegram.events, `${path}.events`)
    for (const [eventKey, enabled] of Object.entries(telegram.events)) {
      if (!TELEGRAM_NOTIFICATION_EVENT_KEYS.includes(eventKey)) {
        fail(`${path}.events.${eventKey}`, "a supported Telegram notification event key")
      }
      requireBoolean(enabled, `${path}.events.${eventKey}`)
    }
  }
}

/** Validate Harvester's application-wide configuration, including strategy and notification settings. */
export function validateAppConfig(config) {
  requireRecord(config, "root")
  validateTelegramNotificationConfig(config)
  if (config.runtime !== undefined) {
    fail("runtime", "must not be present; exchange mode is selected by TRADING_MODE")
  }
  requireRecord(config.strategies, "strategies")
  requireRecord(config.strategies.CG_coinGrabber, "strategies.CG_coinGrabber")
  const strategy = config.strategies.CG_coinGrabber
  requireBoolean(strategy.enabled, "strategies.CG_coinGrabber.enabled")
  if (!strategy.enabled) {
    fail("strategies.CG_coinGrabber.enabled", "CG_coinGrabber must remain enabled")
  }
  requireRecord(strategy.settings, "strategies.CG_coinGrabber.settings")
  const settingsPath = "strategies.CG_coinGrabber.settings"
  if (Object.hasOwn(strategy.settings, "minProfit")) {
    fail(`${settingsPath}.minProfit`, "must be configured on each market pair")
  }
  requireRecord(strategy.settings.conservative, `${settingsPath}.conservative`)
  requireBoolean(strategy.settings.conservative.enabled, `${settingsPath}.conservative.enabled`)
  if (!strategy.settings.conservative.enabled) {
    fail(`${settingsPath}.conservative.enabled`, "Conservative must remain enabled")
  }
  requireRecord(strategy.settings.aggressive, `${settingsPath}.aggressive`)
  requireBoolean(strategy.settings.aggressive.enabled, `${settingsPath}.aggressive.enabled`)
  if (strategy.settings.aggressive.enabled) {
    fail(`${settingsPath}.aggressive.enabled`, "Aggressive strategy is deferred and must remain disabled")
  }
  requireRecord(strategy.pairs, "strategies.CG_coinGrabber.pairs")
  const pairs = Object.entries(strategy.pairs)
  if (pairs.length === 0) {
    fail("strategies.CG_coinGrabber.pairs", "at least one pair")
  }
  for (const [symbol, pair] of pairs) {
    const pairPath = `strategies.CG_coinGrabber.pairs.${symbol}`
    if (!symbol.trim()) {
      fail("strategies.CG_coinGrabber.pairs", "non-empty pair symbols")
    }
    requireRecord(pair, pairPath)
    requireBoolean(pair.enabled, `${pairPath}.enabled`)
    requireBoolean(pair.enableVolatilityProtection, `${pairPath}.enableVolatilityProtection`)
    requireNumber(pair.investment, `${pairPath}.investment`, { min: 0, exclusiveMin: true })
    requireNumber(pair.orderQuantity, `${pairPath}.orderQuantity`, { min: 0, exclusiveMin: true })
    requireNumber(pair.keepQuantity, `${pairPath}.keepQuantity`, { min: 0 })
    requireNumber(pair.minProfit, `${pairPath}.minProfit`, { min: 0.01 })
    requireNumber(pair.priceStepPercent, `${pairPath}.priceStepPercent`, { min: 0, exclusiveMin: true, max: 100, exclusiveMax: true })
    requirePrecision(pair.pricePrecision, `${pairPath}.pricePrecision`)
    requirePrecision(pair.quantityPrecision, `${pairPath}.quantityPrecision`)
    requireNumber(pair.makerPercent, `${pairPath}.makerPercent`, { min: 0, max: 100, exclusiveMax: true })
    requireNumber(pair.takerPercent, `${pairPath}.takerPercent`, { min: 0, max: 100, exclusiveMax: true })
  }
  return config
}

/** Resolve the fixed Binance broker and mandatory exchange mode from the process environment. */
export function resolveRuntimeConfig({ tradingMode, environment } = {}) {
  if (tradingMode !== "testnet" && tradingMode !== "live") {
    throw new Error('TRADING_MODE must be set to "testnet" or "live"')
  }
  return Object.freeze({ environment: environment ?? "unspecified", brokerName: "binance", tradingMode, tradingEnabled: true })
}
