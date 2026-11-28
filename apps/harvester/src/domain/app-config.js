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

const fail = ({ path,
  expectation }) => { throw new ConfigValidationError(path, expectation) }
const requireRecord = ({ value,
  path }) => { if (!isRecord(value)) {fail({ path,
expectation: "an object" })} }
const requireBoolean = ({ value,
  path }) => { if (typeof value !== "boolean") {fail({ path,
expectation: "a boolean" })} }
const requireNumber = ({ value,
  path,
  min = -Infinity,
  exclusiveMin = false,
  max = Infinity,
  exclusiveMax = false }) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {fail({ path,
expectation: "a finite number" })}
  const validMinimum = exclusiveMin ? value > min : value >= min
  if (!validMinimum) {fail({ path,
expectation: exclusiveMin ? `a finite number greater than ${min}` : `a finite number greater than or equal to ${min}` })}
  const validMaximum = exclusiveMax ? value < max : value <= max
  if (!validMaximum) {fail({ path,
expectation: exclusiveMax ? `a finite number less than ${max}` : `a finite number less than or equal to ${max}` })}
}
const requirePrecision = ({ value,
  path }) => { if (!Number.isInteger(value) || value < 0) {fail({ path,
expectation: "a non-negative integer" })} }


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

function validateComponentConfig(config) {
  if (config.components === undefined) {
    return
  }
  const path = "components"
  requireRecord({
    value: config.components,
    path,
  })
  for (const [componentName, componentConfig] of Object.entries(config.components)) {
    if (!["tradingHistoryApi", "recovery"].includes(componentName)) {
      fail({
        path: `${path}.${componentName}`,
        expectation: "a supported component",
      })
    }
    const componentPath = `${path}.${componentName}`
    requireRecord({
      value: componentConfig,
      path: componentPath,
    })
    for (const key of Object.keys(componentConfig)) {
      if (key !== "enabled") {
        fail({
          path: `${componentPath}.${key}`,
          expectation: "only the enabled component-selection field",
        })
      }
    }
    requireBoolean({
      value: componentConfig.enabled,
      path: `${componentPath}.enabled`,
    })
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
const PROVIDER_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const PROVIDER_TYPE_PATTERN = /^[a-z0-9-]+$/i
const CREDENTIAL_ENVIRONMENT_PATTERN = /^[A-Z][A-Z0-9_]*$/

function validateProviderIdentityFields({ provider,
  path }) {
  const supportedKeys = new Set([
    "providerInstanceId",
    "providerType",
    "accountId",
    "environment",
    "credentials",
    "required",
  ])
  for (const key of Object.keys(provider)) {
    if (!supportedKeys.has(key)) {
      fail({
        path: `${path}.${key}`,
        expectation: "a supported provider-instance configuration field",
      })
    }
  }
  for (const field of ["providerInstanceId", "accountId"]) {
    if (typeof provider[field] !== "string" || !PROVIDER_IDENTIFIER_PATTERN.test(provider[field])) {
      fail({
        path: `${path}.${field}`,
        expectation: "a stable non-secret identifier",
      })
    }
  }
  if (typeof provider.providerType !== "string" || !PROVIDER_TYPE_PATTERN.test(provider.providerType)) {
    fail({
      path: `${path}.providerType`,
      expectation: "a simple provider identifier such as binance",
    })
  }
  if (provider.environment !== TRADING_ENVIRONMENTS.TESTNET && provider.environment !== TRADING_ENVIRONMENTS.LIVE) {
    fail({
      path: `${path}.environment`,
      expectation: "testnet or live",
    })
  }
  if (provider.required !== undefined) {
    requireBoolean({
      value: provider.required,
      path: `${path}.required`,
    })
  }
}

function validateProviderIdentityUniqueness({ provider,
  instanceIds,
  accountScopes }) {
  if (instanceIds.has(provider.providerInstanceId)) {
    fail({
      path: "brokers.instances",
      expectation: "unique providerInstanceId values",
    })
  }
  instanceIds.add(provider.providerInstanceId)
  const accountScope = JSON.stringify([
    provider.providerType,
    provider.accountId,
    provider.environment,
  ])
  if (accountScopes.has(accountScope)) {
    fail({
      path: "brokers.instances",
      expectation: "unique providerType/accountId/environment identities",
    })
  }
  accountScopes.add(accountScope)
}

function validateProviderCredentials({
  credentials,
  path,
  credentialNames,
}) {
  const credentialsPath = `${path}.credentials`
  requireRecord({
    value: credentials,
    path: credentialsPath,
  })
  for (const key of Object.keys(credentials)) {
    if (key !== "apiKeyEnv" && key !== "apiSecretEnv") {
      fail({
        path: `${credentialsPath}.${key}`,
        expectation: "apiKeyEnv or apiSecretEnv; secret values must stay in the process environment",
      })
    }
  }
  for (const field of ["apiKeyEnv", "apiSecretEnv"]) {
    const value = credentials[field]
    if (typeof value !== "string" || !CREDENTIAL_ENVIRONMENT_PATTERN.test(value)) {
      fail({
        path: `${credentialsPath}.${field}`,
        expectation: "an uppercase environment-variable name",
      })
    }
  }
  if (credentials.apiKeyEnv === credentials.apiSecretEnv) {
    fail({
      path: credentialsPath,
      expectation: "different API key and API secret environment-variable names",
    })
  }
  for (const name of [credentials.apiKeyEnv, credentials.apiSecretEnv]) {
    if (credentialNames.has(name)) {
      fail({
        path: credentialsPath,
        expectation: "credential environment-variable names unique to each provider account",
      })
    }
    credentialNames.add(name)
  }
}

function validateProviderInstanceConfig({
  provider,
  index,
  instanceIds,
  accountScopes,
  credentialNames,
}) {
  const path = `brokers.instances[${index}]`
  requireRecord({
    value: provider,
    path,
  })
  validateProviderIdentityFields({
    provider,
    path,
  })
  validateProviderIdentityUniqueness({
    provider,
    instanceIds,
    accountScopes,
  })
  validateProviderCredentials({
    credentials: provider.credentials,
    path,
    credentialNames,
  })
}




function validateRecoverySellerPairIdentity({ symbol, pair, pairPath }) {
  if (!symbol.trim()) {
    fail({
      path: "strategies.RS_recoverySeller.pairs",
      expectation: "non-empty pair symbols",
    })
  }
  requireRecord({
    value: pair,
    path: pairPath,
  })
  requireBoolean({
    value: pair.enabled,
    path: `${pairPath}.enabled`,
  })
  if (!TRADING_ENVIRONMENT_SET.has(pair.tradingEnvironment)) {
    fail({
      path: `${pairPath}.tradingEnvironment`,
      expectation: "testnet, live, or both",
    })
  }
  requireBoolean({
    value: pair.enableVolatilityProtection,
    path: `${pairPath}.enableVolatilityProtection`,
  })
  if (pair.externalOrdersPolicy !== undefined &&
      !Object.values(EXTERNAL_ORDERS_POLICIES).includes(pair.externalOrdersPolicy)) {
    fail({
      path: `${pairPath}.externalOrdersPolicy`,
      expectation: Object.values(EXTERNAL_ORDERS_POLICIES).join(" or "),
    })
  }
}

function validateRecoverySellerPairTradingSettings({ pair, pairPath }) {
  requireNumber({
    value: pair.orderQuantity,
    path: `${pairPath}.orderQuantity`,
    min: 0,
    exclusiveMin: true,
  })
  requireNumber({
    value: pair.minProfit,
    path: `${pairPath}.minProfit`,
    min: 0.01,
  })
  requireNumber({
    value: pair.priceStepPercent,
    path: `${pairPath}.priceStepPercent`,
    min: 0,
    exclusiveMin: true,
    max: 100,
    exclusiveMax: true,
  })
  requireNumber({
    value: pair.makerPercent,
    path: `${pairPath}.makerPercent`,
    min: 0,
    max: 100,
    exclusiveMax: true,
  })
  requireNumber({
    value: pair.takerPercent,
    path: `${pairPath}.takerPercent`,
    min: 0,
    max: 100,
    exclusiveMax: true,
  })
  requireNumber({
    value: pair.investment,
    path: `${pairPath}.investment`,
    min: 0,
    exclusiveMin: true,
  })
}

function validateRecoverySellerLegacyPosition({ pair, pairPath }) {
  requireRecord({
    value: pair.legacyPosition,
    path: `${pairPath}.legacyPosition`,
  })
  requireNumber({
    value: pair.legacyPosition.invested,
    path: `${pairPath}.legacyPosition.invested`,
    min: 0,
    exclusiveMin: true,
  })
  requireNumber({
    value: pair.legacyPosition.quantity,
    path: `${pairPath}.legacyPosition.quantity`,
    min: 0,
    exclusiveMin: true,
  })
  requireNumber({
    value: pair.sellQuantity,
    path: `${pairPath}.sellQuantity`,
    min: 0,
  })
  if (pair.sellQuantity > pair.legacyPosition.quantity) {
    fail({
      path: `${pairPath}.sellQuantity`,
      expectation: "no greater than the explicitly authorized original legacy quantity",
    })
  }
}

function validateRecoverySellerPairPrecision({ pair, pairPath }) {
  requirePrecision({
    value: pair.pricePrecision,
    path: `${pairPath}.pricePrecision`,
  })
  requirePrecision({
    value: pair.quantityPrecision,
    path: `${pairPath}.quantityPrecision`,
  })
}

/** Validate one explicitly authorized Recovery Seller market. */
function validateRecoverySellerPair({ symbol, pair }) {
  const pairPath = `strategies.RS_recoverySeller.pairs.${symbol}`
  validateRecoverySellerPairIdentity({
    symbol,
    pair,
    pairPath,
  })
  validateRecoverySellerPairTradingSettings({
    pair,
    pairPath,
  })
  validateRecoverySellerLegacyPosition({
    pair,
    pairPath,
  })
  validateRecoverySellerPairPrecision({
    pair,
    pairPath,
  })
}

function validateRecoverySellerConfig(config) {
  const strategy = config.strategies.RS_recoverySeller
  if (strategy === undefined) {
    return
  }
  const path = "strategies.RS_recoverySeller"
  requireRecord({
    value: strategy,
    path,
  })
  for (const key of Object.keys(strategy)) {
    if (key !== "enabled" && key !== "pairs") {
      fail({
        path: `${path}.${key}`,
        expectation: "only enabled and pairs are supported",
      })
    }
  }
  requireBoolean({
    value: strategy.enabled,
    path: `${path}.enabled`,
  })
  requireRecord({
    value: strategy.pairs,
    path: `${path}.pairs`,
  })
  const pairs = Object.entries(strategy.pairs)
  if (strategy.enabled && pairs.length === 0) {
    fail({
      path: `${path}.pairs`,
      expectation: "at least one explicitly authorized market when RS is enabled",
    })
  }
  for (const [symbol, pair] of pairs) {
    validateRecoverySellerPair({
      symbol,
      pair,
    })
  }
  if (strategy.enabled && !pairs.some(([, pair]) => pair.enabled)) {
    fail({
      path: `${path}.pairs`,
      expectation: "at least one enabled Recovery Seller market",
    })
  }
}

function validateBrokerProviderInstances(config) {
  if (config.brokers === undefined) {
    return
  }
  requireRecord({
    value: config.brokers,
    path: "brokers",
  })
  for (const key of Object.keys(config.brokers)) {
    if (key !== "instances") {
      fail({
        path: `brokers.${key}`,
        expectation: "the supported instances configuration field",
      })
    }
  }
  if (!Array.isArray(config.brokers.instances) || config.brokers.instances.length === 0) {
    fail({
      path: "brokers.instances",
      expectation: "a non-empty array of provider instances",
    })
  }
  const instanceIds = new Set()
  const accountScopes = new Set()
  const credentialNames = new Set()
  for (const [index, provider] of config.brokers.instances.entries()) {
    validateProviderInstanceConfig({
      provider,
      index,
      instanceIds,
      accountScopes,
      credentialNames,
    })
  }
}

/** Validate Harvester's application-wide configuration, including strategy and notification settings. */
function validateExecutionRouting(config) {
  if (config.executionRouting === undefined) {
    return
  }
  const path = "executionRouting"
  requireRecord({ value: config.executionRouting,
  path })
  for (const key of Object.keys(config.executionRouting)) {
    if (key !== "routes") {
      fail({ path: `${path}.${key}`,
  expectation: "a supported execution-routing configuration field" })
    }
  }
  const { routes } = config.executionRouting
  if (!Array.isArray(routes) || routes.length === 0) {
    fail({ path: `${path}.routes`,
  expectation: "a non-empty array of explicit strategy/market execution routes" })
  }
  const seen = new Set()
  for (const [index, route] of routes.entries()) {
    const routePath = `${path}.routes[${index}]`
    requireRecord({ value: route,
  path: routePath })
    for (const key of Object.keys(route)) {
      if (!["strategyId", "symbol", "providerInstanceId"].includes(key)) {
        fail({ path: `${routePath}.${key}`,
  expectation: "only strategyId, symbol, and providerInstanceId" })
      }
    }
    for (const field of ["strategyId", "symbol", "providerInstanceId"]) {
      if (typeof route[field] !== "string" || !route[field].trim() || route[field] !== route[field].trim()) {
        fail({ path: `${routePath}.${field}`,
  expectation: "a non-empty trimmed string" })
      }
    }
    const key = JSON.stringify([route.strategyId, route.symbol])
    if (seen.has(key)) {
      fail({ path: `${path}.routes`,
  expectation: "unique strategyId/symbol execution routes" })
    }
    seen.add(key)
  }
}

export function validateAppConfig(config) {
  requireRecord({ value: config,
path: "root" })

  validateTelegramNotificationConfig(config)
  validateComponentConfig(config)
  validateTelegramOperatorControlConfig(config)
  validateBrokerProviderInstances(config)
  validateExecutionRouting(config)
  requireRecord({ value: config.strategies,
path: "strategies" })
  validateRecoverySellerConfig(config)
  if (config.runtime !== undefined) {fail({ path: "runtime",
expectation: "must not be present; exchange mode is selected by TRADING_MODE" })}
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
export function selectPairsForTradingMode({ pairs,
  tradingMode } = {}) {
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

/** Resolve the fixed Binance broker and mandatory exchange mode from the process environment. */
export function resolveRuntimeConfig({ tradingMode,
  environment } = {}) {
  if (tradingMode !== TRADING_ENVIRONMENTS.TESTNET && tradingMode !== TRADING_ENVIRONMENTS.LIVE) {throw new Error('TRADING_MODE must be set to "testnet" or "live"')}
  return Object.freeze({ environment: environment ?? "unspecified",
brokerName: "binance",
tradingMode,
tradingEnabled: true })
}
