import { NOTIFICATIONS_TG_PROFILES } from "../../config/notifications-tg-profiles.js"
import { EXTERNAL_ORDERS_POLICIES } from "./external-orders-policy.js"
import { TRADING_ENVIRONMENTS } from "./trading-environment.js"

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
const TRADING_ENVIRONMENT_VALUES = Object.values(TRADING_ENVIRONMENTS)
const TRADING_ENVIRONMENT_SET = new Set(TRADING_ENVIRONMENT_VALUES)
export class ConfigValidationError extends TypeError {
  constructor(...args) {
    const [path, expected] = args
    super(`Invalid app config at "${path}": expected ${expected}`)
    this.name = "ConfigValidationError"
    this.path = path
    this.expected = expected
  }
}

const fail = ({ path, expectation }) => { throw new ConfigValidationError(path, expectation) }
const requireRecord = ({ value, path }) => { if (!isRecord(value)) {fail({ path,
expectation: "an object" })} }
const requireBoolean = ({ value, path }) => { if (typeof value !== "boolean") {fail({ path,
expectation: "a boolean" })} }
const requireNumber = ({ value, path, min = -Infinity, exclusiveMin = false, max = Infinity, exclusiveMax = false }) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {fail({ path,
expectation: "a finite number" })}
  const validMinimum = exclusiveMin ? value > min : value >= min
  if (!validMinimum) {fail({ path,
expectation: exclusiveMin ? `a finite number greater than ${min}` : `a finite number greater than or equal to ${min}` })}
  const validMaximum = exclusiveMax ? value < max : value <= max
  if (!validMaximum) {fail({ path,
expectation: exclusiveMax ? `a finite number less than ${max}` : `a finite number less than or equal to ${max}` })}
}
const requirePrecision = ({ value, path }) => { if (!Number.isInteger(value) || value < 0) {fail({ path,
expectation: "a non-negative integer" })} }


const TELEGRAM_NOTIFICATION_PROFILES = Object.freeze(Object.values(NOTIFICATIONS_TG_PROFILES))
export const TELEGRAM_NOTIFICATION_EVENT_KEYS = Object.freeze([
  "orderSubmitted", "orderCancelled", "orderFailed", "fillReceived", "pairPaused",
  "recoveryCompleted", "recoveryFailed", "botStarted", "botStopped", "startupFailed",
  "brokerConnected", "brokerDisconnected", "accountSafetyAlert",
])

function validateTelegramNotificationConfig(config) {
  if (config.notifications === undefined) {return}
  requireRecord({ value: config.notifications,
path: "notifications" })
  const {telegram} = config.notifications
  if (telegram === undefined) {return}
  requireRecord({ value: telegram,
path: "notifications.telegram" })
  const path = "notifications.telegram"

  if (telegram.enabled !== undefined) {requireBoolean({ value: telegram.enabled,
path: `${path}.enabled` })}
  if (telegram.profile !== undefined && !TELEGRAM_NOTIFICATION_PROFILES.includes(telegram.profile)) {
    fail({ path: `${path}.profile`,
expectation: "one of minimal, trader, verbose, or custom" })
  }
  if (telegram.markets !== undefined) {
    if (!Array.isArray(telegram.markets)) {fail({ path: `${path}.markets`,
expectation: "an array of unique non-empty market symbols" })}
    const seenMarkets = new Set()
    for (const [index, symbol] of telegram.markets.entries()) {
      if (typeof symbol !== "string" || !symbol.trim() || symbol !== symbol.trim()) {
        fail({ path: `${path}.markets[${index}]`,
expectation: "a non-empty trimmed market symbol" })
      }
      if (seenMarkets.has(symbol)) {fail({ path: `${path}.markets`,
expectation: "unique market symbols" })}
      seenMarkets.add(symbol)
    }
  }
  if (telegram.events !== undefined) {
    requireRecord({ value: telegram.events,
path: `${path}.events` })
    for (const [eventKey, enabled] of Object.entries(telegram.events)) {
      if (!TELEGRAM_NOTIFICATION_EVENT_KEYS.includes(eventKey)) {
        fail({ path: `${path}.events.${eventKey}`,
expectation: "a supported Telegram notification event key" })
      }
      requireBoolean({ value: enabled,
path: `${path}.events.${eventKey}` })
    }
  }
}

function validateTelegramOperatorControlConfig(appConfig) {
  if (appConfig.operatorControl === undefined) {
    return
  }
  const path = "operatorControl"
  requireRecord({ value: appConfig.operatorControl,
path })
  for (const key of Object.keys(appConfig.operatorControl)) {
    if (key !== "telegram") {
      fail({ path: `${path  }.${  key}`,
expectation: "a supported operator-control configuration field" })
    }
  }
  const {telegram} = appConfig.operatorControl
  requireRecord({ value: telegram,
path: `${path  }.telegram` })
  for (const key of Object.keys(telegram)) {
    if (key !== "enabled" && key !== "allowedUserIds") {
      fail({ path: `${path  }.telegram.${  key}`,
expectation: "a supported Telegram operator configuration field" })
    }
  }
  requireBoolean({ value: telegram.enabled,
path: `${path  }.telegram.enabled` })
  if (!Array.isArray(telegram.allowedUserIds)) {
    fail({ path: `${path  }.telegram.allowedUserIds`,
expectation: "an array of unique positive decimal Telegram user IDs" })
  }
  const seenUserIds = new Set()
  for (const userId of telegram.allowedUserIds) {
    if (typeof userId !== "string" || !/^[1-9][0-9]*$/.test(userId) || !Number.isSafeInteger(Number(userId))) {
      fail({ path: `${path  }.telegram.allowedUserIds`,
expectation: "canonical positive decimal Telegram user ID strings" })
    }
    if (seenUserIds.has(userId)) {
      fail({ path: `${path  }.telegram.allowedUserIds`,
expectation: "unique positive decimal Telegram user IDs" })
    }
    seenUserIds.add(userId)
  }
}

function validateBrokerConfiguration(config) {
  if (config.brokers === undefined) {
    return
  }
  requireRecord({ value: config.brokers, path: "brokers" })
  for (const key of Object.keys(config.brokers)) {
    if (key !== "instances" && key !== "selection") {
      fail({ path: `brokers.${key}`, expectation: "instances or selection" })
    }
  }
  requireRecord({ value: config.brokers.instances, path: "brokers.instances" })
  const entries = Object.entries(config.brokers.instances)
  if (entries.length === 0) {
    fail({ path: "brokers.instances", expectation: "at least one provider instance" })
  }
  const ids = new Set()
  for (const [id, definition] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) {
      fail({ path: "brokers.instances", expectation: "stable provider instance IDs" })
    }
    requireRecord({ value: definition, path: `brokers.instances.${id}` })
    for (const key of Object.keys(definition)) {
      if (key !== "provider" && key !== "accountId" && key !== "credentialEnv") {
        fail({ path: `brokers.instances.${id}.${key}`, expectation: "provider and non-secret accountId only" })
      }
    }
    if (typeof definition.provider !== "string" || !definition.provider.trim()) {
      fail({ path: `brokers.instances.${id}.provider`, expectation: "a non-empty provider type" })
    }
    if (typeof definition.accountId !== "string" || !definition.accountId.trim()) {
      fail({ path: `brokers.instances.${id}.accountId`, expectation: "a stable non-secret account ID" })
    }
    if (definition.credentialEnv !== undefined) {
      requireRecord({ value: definition.credentialEnv, path: `brokers.instances.${id}.credentialEnv` })
      for (const key of Object.keys(definition.credentialEnv)) {
        if (key !== "apiKey" && key !== "apiSecret") {
          fail({ path: `brokers.instances.${id}.credentialEnv.${key}`, expectation: "apiKey or apiSecret environment variable name" })
        }
      }
      for (const key of ["apiKey", "apiSecret"]) {
        if (typeof definition.credentialEnv[key] !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(definition.credentialEnv[key])) {
          fail({ path: `brokers.instances.${id}.credentialEnv.${key}`, expectation: "an environment variable name, never a secret value" })
        }
      }
    }
    ids.add(id)
  }
  requireRecord({ value: config.brokers.selection, path: "brokers.selection" })
  const selection = config.brokers.selection
  for (const key of Object.keys(selection)) {
    if (!["execution", "account", "marketData"].includes(key)) {
      fail({ path: `brokers.selection.${key}`, expectation: "execution, account, or marketData" })
    }
  }
  for (const role of ["execution", "account", "marketData"]) {
    if (typeof selection[role] !== "string" || !ids.has(selection[role])) {
      fail({ path: `brokers.selection.${role}`, expectation: "an existing provider instance ID" })
    }
  }
  if (new Set([selection.execution, selection.account, selection.marketData]).size !== 1) {
    fail({ path: "brokers.selection", expectation: "one shared instance until account and execution isolation are implemented" })
  }
}

/** Validate CG coin-grabber strategy settings. */
function validateStrategySettings(strategy) {
  requireRecord({ value: strategy.settings,
path: "strategies.CG_coinGrabber.settings" })
  const settingsPath = "strategies.CG_coinGrabber.settings"
  if (Object.hasOwn(strategy.settings, "minProfit")) {
    fail({ path: `${settingsPath}.minProfit`,
expectation: "must be configured on each market pair" })
  }
  requireRecord({ value: strategy.settings.conservative,
path: `${settingsPath}.conservative` })
  requireBoolean({ value: strategy.settings.conservative.enabled,
path: `${settingsPath}.conservative.enabled` })
  if (!strategy.settings.conservative.enabled) {fail({ path: `${settingsPath}.conservative.enabled`,
expectation: "Conservative must remain enabled" })}
  requireRecord({ value: strategy.settings.aggressive,
path: `${settingsPath}.aggressive` })
  requireBoolean({ value: strategy.settings.aggressive.enabled,
path: `${settingsPath}.aggressive.enabled` })
  if (strategy.settings.aggressive.enabled) {fail({ path: `${settingsPath}.aggressive.enabled`,
expectation: "Aggressive strategy is deferred and must remain disabled" })}
  if (strategy.settings.recovery !== undefined) {
    requireRecord({ value: strategy.settings.recovery,
path: `${settingsPath}.recovery` })
    requireBoolean({ value: strategy.settings.recovery.enabled,
path: `${settingsPath}.recovery.enabled` })
    if (strategy.settings.recovery.enabled) {
      fail({ path: `${settingsPath}.recovery.enabled`,
expectation: "process-restart recovery is deferred and must remain disabled" })
    }
  }
}

function validateStrategyPairs(strategy) {
  requireRecord({ value: strategy.pairs,
path: "strategies.CG_coinGrabber.pairs" })
  const pairs = Object.entries(strategy.pairs)
  if (pairs.length === 0) {fail({ path: "strategies.CG_coinGrabber.pairs",
expectation: "at least one pair" })}
  for (const [symbol, pair] of pairs) {
    const pairPath = `strategies.CG_coinGrabber.pairs.${symbol}`
    if (!symbol.trim()) {fail({ path: "strategies.CG_coinGrabber.pairs",
expectation: "non-empty pair symbols" })}
    requireRecord({ value: pair,
path: pairPath })
    requireBoolean({ value: pair.enabled,
path: `${pairPath}.enabled` })
    if (!TRADING_ENVIRONMENT_SET.has(pair.tradingEnvironment)) {
      fail({ path: `${pairPath}.tradingEnvironment`,
expectation: "testnet, live, or both" })
    }
    requireBoolean({ value: pair.enableVolatilityProtection,
path: `${pairPath}.enableVolatilityProtection` })
    if (pair.externalOrdersPolicy !== undefined && !Object.values(EXTERNAL_ORDERS_POLICIES).includes(pair.externalOrdersPolicy)) {
      fail({ path: `${pairPath}.externalOrdersPolicy`,
expectation: Object.values(EXTERNAL_ORDERS_POLICIES).join(" or ") })
    }
    requireNumber({ value: pair.investment,
path: `${pairPath}.investment`,
...{ min: 0,
exclusiveMin: true } })
    requireNumber({ value: pair.orderQuantity,
path: `${pairPath}.orderQuantity`,
...{ min: 0,
exclusiveMin: true } })
    requireNumber({ value: pair.keepQuantity,
path: `${pairPath}.keepQuantity`,
...{ min: 0 } })
    requireNumber({ value: pair.minProfit,
path: `${pairPath}.minProfit`,
...{ min: 0.01 } })
    requireNumber({ value: pair.priceStepPercent,
path: `${pairPath}.priceStepPercent`,
...{ min: 0,
exclusiveMin: true,
max: 100,
exclusiveMax: true } })
    requirePrecision({ value: pair.pricePrecision,
path: `${pairPath}.pricePrecision` })
    requirePrecision({ value: pair.quantityPrecision,
path: `${pairPath}.quantityPrecision` })
    requireNumber({ value: pair.makerPercent,
path: `${pairPath}.makerPercent`,
...{ min: 0,
max: 100,
exclusiveMax: true } })
    requireNumber({ value: pair.takerPercent,
path: `${pairPath}.takerPercent`,
...{ min: 0,
max: 100,
exclusiveMax: true } })
  }
}
/** Validate Harvester's application-wide configuration, including strategy and notification settings. */
export function validateAppConfig(config) {
  requireRecord({ value: config,
path: "root" })

  validateTelegramNotificationConfig(config)
  validateTelegramOperatorControlConfig(config)
  validateBrokerConfiguration(config)
  if (config.runtime !== undefined) {fail({ path: "runtime",
expectation: "must not be present; exchange mode is selected by TRADING_MODE" })}
  requireRecord({ value: config.strategies,
path: "strategies" })
  requireRecord({ value: config.strategies.CG_coinGrabber,
path: "strategies.CG_coinGrabber" })
  const strategy = config.strategies.CG_coinGrabber
  requireBoolean({ value: strategy.enabled,
path: "strategies.CG_coinGrabber.enabled" })
  if (!strategy.enabled) {fail({ path: "strategies.CG_coinGrabber.enabled",
expectation: "CG_coinGrabber must remain enabled" })}
  validateStrategySettings(strategy)
  validateStrategyPairs(strategy)
  return config
}

/**
 * Select pairs for the mandatory Binance trading mode and remove the config-only selector.
 *
 * @param {{pairs: object, tradingMode: "testnet"|"live"}} options - Source pair map and resolved exchange mode.
 * @returns {object} Matching runtime pair map without tradingEnvironment.
 * @throws {ConfigValidationError} If any pair has a missing or unsupported selector.
 */
export function selectPairsForTradingMode({ pairs, tradingMode } = {}) {
  if (tradingMode !== TRADING_ENVIRONMENTS.TESTNET && tradingMode !== TRADING_ENVIRONMENTS.LIVE) {
    fail({ path: "TRADING_MODE",
expectation: "testnet or live" })
  }
  requireRecord({ value: pairs,
path: "strategies.CG_coinGrabber.pairs" })
  const selectedPairs = {}
  for (const [symbol, pair] of Object.entries(pairs)) {
    const pairPath = `strategies.CG_coinGrabber.pairs.${symbol}`
    if (!symbol.trim()) {fail({ path: "strategies.CG_coinGrabber.pairs",
expectation: "non-empty pair symbols" })}
    requireRecord({ value: pair,
path: pairPath })
    if (!TRADING_ENVIRONMENT_SET.has(pair.tradingEnvironment)) {
      fail({ path: `${pairPath}.tradingEnvironment`,
expectation: "testnet, live, or both" })
    }
    if (pair.tradingEnvironment !== TRADING_ENVIRONMENTS.BOTH && pair.tradingEnvironment !== tradingMode) {
      continue
    }
    const runtimePair = { ...pair }
    delete runtimePair.tradingEnvironment
    selectedPairs[symbol] = runtimePair
  }
  return selectedPairs
}

/** Resolve the mandatory exchange environment without selecting a provider. */
export function resolveRuntimeConfig({ tradingMode, environment } = {}) {
  if (tradingMode !== TRADING_ENVIRONMENTS.TESTNET && tradingMode !== TRADING_ENVIRONMENTS.LIVE) {throw new Error('TRADING_MODE must be set to "testnet" or "live"')}
  return Object.freeze({ environment: environment ?? "unspecified",
tradingMode,
tradingEnabled: true })
}
