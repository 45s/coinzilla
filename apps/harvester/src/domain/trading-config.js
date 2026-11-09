const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
const fail = (path, expectation) => { throw new TypeError(`Invalid trading config at "${path}": expected ${expectation}`) }
const requireRecord = (value, path) => { if (!isRecord(value)) fail(path, "an object") }
const requireBoolean = (value, path) => { if (typeof value !== "boolean") fail(path, "a boolean") }
const requireNumber = (value, path, { min = -Infinity, exclusiveMin = false, max = Infinity, exclusiveMax = false } = {}) => {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "a finite number")
  const validMinimum = exclusiveMin ? value > min : value >= min
  if (!validMinimum) fail(path, exclusiveMin ? `a finite number greater than ${min}` : `a finite number greater than or equal to ${min}`)
  const validMaximum = exclusiveMax ? value < max : value <= max
  if (!validMaximum) fail(path, exclusiveMax ? `a finite number less than ${max}` : `a finite number less than or equal to ${max}`)
}
const requirePrecision = (value, path) => { if (!Number.isInteger(value) || value < 0) fail(path, "a non-negative integer") }

function validateRuntimeProfiles(runtime) {
  requireRecord(runtime, "runtime")
  requireRecord(runtime.profiles, "runtime.profiles")
  for (const [name, profile] of Object.entries(runtime.profiles)) {
    const profilePath = `runtime.profiles.${name}`
    if (!["default", "development", "test", "production"].includes(name)) {
      fail("runtime.profiles", "only default, development, test, and production profiles")
    }
    requireRecord(profile, profilePath)
    if (profile.broker !== null && profile.broker !== "binance") {
      fail(`${profilePath}.broker`, 'null or "binance"')
    }
    requireRecord(profile.trading, `${profilePath}.trading`)
    requireBoolean(profile.trading.enabled, `${profilePath}.trading.enabled`)
    if (!["testnet", "live"].includes(profile.trading.mode)) {
      fail(`${profilePath}.trading.mode`, '"testnet" or "live"')
    }
    if (name === "development" && profile.trading.enabled && profile.trading.mode !== "testnet") {
      fail(`${profilePath}.trading.mode`, '"testnet" for development execution')
    }
    if (name === "production" && profile.trading.enabled && profile.trading.mode !== "live") {
      fail(`${profilePath}.trading.mode`, '"live" for production execution')
    }
    if (profile.trading.enabled && profile.broker !== "binance") {
      fail(`${profilePath}.broker`, ' "binance" when trading is enabled')
    }
  }
}

/** Validate CG_coinGrabber and its strategy-owned settings and pairs. */
export function validateTradingConfig(config) {
  requireRecord(config, "root")
  if (config.runtime !== undefined) validateRuntimeProfiles(config.runtime)
  requireRecord(config.strategies, "strategies")
  requireRecord(config.strategies.CG_coinGrabber, "strategies.CG_coinGrabber")
  const strategy = config.strategies.CG_coinGrabber
  requireBoolean(strategy.enabled, "strategies.CG_coinGrabber.enabled")
  if (!strategy.enabled) fail("strategies.CG_coinGrabber.enabled", "CG_coinGrabber must remain enabled")
  requireRecord(strategy.settings, "strategies.CG_coinGrabber.settings")
  const settingsPath = "strategies.CG_coinGrabber.settings"
  requireNumber(strategy.settings.minProfit, `${settingsPath}.minProfit`, { min: 0.01 })
  requireRecord(strategy.settings.conservative, `${settingsPath}.conservative`)
  requireBoolean(strategy.settings.conservative.enabled, `${settingsPath}.conservative.enabled`)
  if (!strategy.settings.conservative.enabled) fail(`${settingsPath}.conservative.enabled`, "Conservative must remain enabled")
  requireRecord(strategy.settings.aggressive, `${settingsPath}.aggressive`)
  requireBoolean(strategy.settings.aggressive.enabled, `${settingsPath}.aggressive.enabled`)
  if (strategy.settings.aggressive.enabled) fail(`${settingsPath}.aggressive.enabled`, "Aggressive strategy is deferred and must remain disabled")
  requireRecord(strategy.pairs, "strategies.CG_coinGrabber.pairs")
  const pairs = Object.entries(strategy.pairs)
  if (pairs.length === 0) fail("strategies.CG_coinGrabber.pairs", "at least one pair")
  for (const [symbol, pair] of pairs) {
    const pairPath = `strategies.CG_coinGrabber.pairs.${symbol}`
    if (!symbol.trim()) fail("strategies.CG_coinGrabber.pairs", "non-empty pair symbols")
    requireRecord(pair, pairPath)
    requireBoolean(pair.enabled, `${pairPath}.enabled`)
    requireNumber(pair.investment, `${pairPath}.investment`, { min: 0, exclusiveMin: true })
    requireNumber(pair.orderQuantity, `${pairPath}.orderQuantity`, { min: 0, exclusiveMin: true })
    requireNumber(pair.keepQuantity, `${pairPath}.keepQuantity`, { min: 0 })
    requireNumber(pair.priceStepPercent, `${pairPath}.priceStepPercent`, { min: 0, exclusiveMin: true, max: 100, exclusiveMax: true })
    requirePrecision(pair.pricePrecision, `${pairPath}.pricePrecision`)
    requirePrecision(pair.quantityPrecision, `${pairPath}.quantityPrecision`)
    requireNumber(pair.makerPercent, `${pairPath}.makerPercent`, { min: 0, max: 100, exclusiveMax: true })
    requireNumber(pair.takerPercent, `${pairPath}.takerPercent`, { min: 0, max: 100, exclusiveMax: true })
  }
  return config
}

/** Resolve the runtime profile selected by standard NODE_ENV. Missing profiles fail safe to read-only/no broker. */
export function resolveHarvesterRuntimeConfig({ config, environment } = {}) {
  const profileName = ["development", "test", "production"].includes(environment)
    ? environment
    : "default"
  const profile = config?.runtime?.profiles?.[profileName] ?? config?.runtime?.profiles?.default
  const brokerName = profile?.broker ?? undefined
  const tradingMode = profile?.trading?.mode ?? "testnet"
  const tradingRequested = profile?.trading?.enabled === true
  if (brokerName !== undefined && brokerName !== "binance") {
    throw new Error("Unsupported broker in runtime profile: " + brokerName)
  }
  if (tradingRequested && brokerName !== "binance") {
    throw new Error("Order execution requires runtime profile broker=binance")
  }
  if (tradingRequested && profileName === "development" && tradingMode !== "testnet") {
    throw new Error("Development order execution requires runtime profile trading.mode=testnet")
  }
  if (tradingRequested && profileName === "production" && tradingMode !== "live") {
    throw new Error("Production order execution requires runtime profile trading.mode=live")
  }
  const tradingEnabled = tradingRequested && brokerName === "binance" &&
    ((profileName === "development" && tradingMode === "testnet") ||
     (profileName === "production" && tradingMode === "live"))

  return Object.freeze({
    environment: profileName,
    brokerName,
    tradingMode,
    tradingRequested,
    tradingEnabled,
  })
}
