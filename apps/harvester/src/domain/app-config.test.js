import test from "node:test"
import assert from "node:assert/strict"
import {
  resolveRuntimeConfig,
  validateAppConfig,
} from "./app-config.js"

const createAppConfig = () => ({
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: {
        minProfit: 0.01,
        conservative: { enabled: true },
        aggressive: { enabled: false },
      },
      pairs: {
        ZROFDUSD: {
          enabled: true,
          investment: 100,
          orderQuantity: 5,
          keepQuantity: 0.01,
          priceStepPercent: 0.05,
          pricePrecision: 3,
          quantityPrecision: 1,
          makerPercent: 0,
          takerPercent: 0.1,
        },
      },
    },
  },
})

test("validates strategy-owned pairs without requiring exchange-mode configuration in JSON", () => {
  const config = createAppConfig()
  assert.equal(validateAppConfig(config), config, "Strategy and pair settings must remain valid without a runtime profile block.")
  assert.equal(Object.hasOwn(config, "runtime"), false, "Exchange selection must not be stored in config.json.")
  assert.equal(config.strategies.CG_coinGrabber.pairs.ZROFDUSD.investment, 100, "The pair investment setting must remain part of strategy configuration.")
})


test("accepts independent minimum-profit thresholds for each market", () => {
  const config = createAppConfig()
  const strategyConfig = config.strategies.CG_coinGrabber
  delete strategyConfig.settings.minProfit
  strategyConfig.pairs.ZROFDUSD.minProfit = 0.01
  strategyConfig.pairs.LINKUSDT = {
    ...strategyConfig.pairs.ZROFDUSD,
    investment: 200,
    orderQuantity: 2,
    keepQuantity: 0,
    minProfit: 0.1,
  }

  assert.equal(validateAppConfig(config), config)
  assert.equal(strategyConfig.pairs.ZROFDUSD.minProfit, 0.01)
  assert.equal(strategyConfig.pairs.LINKUSDT.minProfit, 0.1)
})

test("selects Binance TESTNET from TRADING_MODE even when NODE_ENV says production", () => {
  const runtime = resolveRuntimeConfig({ config: createAppConfig(), tradingMode: "testnet", environment: "production" })
  assert.equal(runtime.brokerName, "binance", "Binance must remain the fixed broker for TESTNET.")
  assert.equal(runtime.tradingMode, "testnet", "TRADING_MODE must select TESTNET independently of NODE_ENV.")
  assert.equal(runtime.tradingEnabled, true, "Trading must be enabled when TESTNET is explicitly selected.")
})

test("selects Binance LIVE from TRADING_MODE even when NODE_ENV says development", () => {
  const runtime = resolveRuntimeConfig({ config: createAppConfig(), tradingMode: "live", environment: "development" })
  assert.equal(runtime.brokerName, "binance", "Binance must remain the fixed broker for LIVE.")
  assert.equal(runtime.tradingMode, "live", "TRADING_MODE must select LIVE independently of NODE_ENV.")
  assert.equal(runtime.tradingEnabled, true, "Selecting LIVE must enable real order execution.")
})

test("fails startup when TRADING_MODE is missing", () => {
  assert.throws(
    () => resolveRuntimeConfig({ config: createAppConfig() }),
    /TRADING_MODE must be set to "testnet" or "live"/,
    "Startup must fail rather than silently choose an exchange mode when TRADING_MODE is absent.",
  )
})

test("rejects every TRADING_MODE value except exact testnet and live", () => {
  for (const tradingMode of ["", "TESTNET", "production", " live", "live "]) {
    assert.throws(
      () => resolveRuntimeConfig({ config: createAppConfig(), tradingMode }),
      /TRADING_MODE must be set to "testnet" or "live"/,
      "An invalid exchange mode must fail startup instead of falling back to another environment: " + JSON.stringify(tradingMode),
    )
  }
})

test("rejects legacy runtime profiles in strategy configuration", () => {
  const config = { ...createAppConfig(), runtime: { profiles: {} } }
  assert.throws(
    () => validateAppConfig(config),
    /runtime.*must not be present/,
    "The trading JSON must not retain a second exchange-mode selector.",
  )
})


test("validates Telegram notification profiles, market filters, and event overrides", () => {
  const config = createAppConfig()
  config.notifications = {
    telegram: {
      enabled: true,
      profile: "custom",
      markets: ["LINKUSDT", "LINKFDUSD"],
      events: { fillReceived: true, pairPaused: false },
    },
  }

  assert.equal(
    validateAppConfig(config),
    config,
    "A valid custom Telegram policy must be accepted as part of the single app configuration.",
  )
})

test("rejects unknown Telegram notification profiles", () => {
  const config = createAppConfig()
  config.notifications = { telegram: { enabled: true, profile: "everything" } }

  assert.throws(
    () => validateAppConfig(config),
    /profile/,
    "An unsupported Telegram profile must fail configuration validation instead of silently selecting another policy.",
  )
})

test("rejects unknown Telegram event override keys and non-boolean values", () => {
  const unknownEvent = createAppConfig()
  unknownEvent.notifications = { telegram: { profile: "custom", events: { orderSubmittedNow: true } } }
  assert.throws(
    () => validateAppConfig(unknownEvent),
    /events/,
    "An unknown Telegram event key must be rejected instead of being silently ignored.",
  )

  const invalidEventValue = createAppConfig()
  invalidEventValue.notifications = { telegram: { profile: "custom", events: { fillReceived: "yes" } } }
  assert.throws(
    () => validateAppConfig(invalidEventValue),
    /boolean/,
    "Every Telegram event override must be an explicit boolean.",
  )
})

test("rejects duplicate or malformed Telegram market filters", () => {
  const duplicateMarkets = createAppConfig()
  duplicateMarkets.notifications = { telegram: { profile: "trader", markets: ["LINKUSDT", "LINKUSDT"] } }
  assert.throws(
    () => validateAppConfig(duplicateMarkets),
    /markets/,
    "Duplicate Telegram market filters must be rejected so policy resolution is deterministic.",
  )

  const malformedMarket = createAppConfig()
  malformedMarket.notifications = { telegram: { profile: "trader", markets: [""] } }
  assert.throws(
    () => validateAppConfig(malformedMarket),
    /markets/,
    "An empty Telegram market symbol must be rejected rather than matching no market accidentally.",
  )
})

test("uses generic app config wording for validation errors", () => {
  assert.throws(
    () => validateAppConfig(null),
    (error) => error instanceof TypeError && error.message.startsWith("Invalid app config"),
    "Configuration validation errors must identify the generic app config, not the application name or trading domain.",
  )
})
