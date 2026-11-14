import test from "node:test"
import assert from "node:assert/strict"
import {
  ConfigValidationError,
  resolveRuntimeConfig,
  validateAppConfig,
} from "./app-config.js"
import { EXTERNAL_ORDERS_POLICIES } from "./external-orders-policy.js"
import { TRADING_ENVIRONMENTS } from "./trading-environment.js"
import { OPERATOR_CONTROL_CONFIG } from "../../config/operator-control.js"
import { appConfig } from "../../config/index.js"
import { loadAppConfig } from "../infrastructure/config/load-app-config.js"

const createAppConfig = () => ({
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: {
        conservative: { enabled: true },
        aggressive: { enabled: false },
      },
      pairs: {
        ZROFDUSD: {
          enabled: true,
          tradingEnvironment: TRADING_ENVIRONMENTS.BOTH,
          enableVolatilityProtection: true,
          investment: 100,
          orderQuantity: 5,
          keepQuantity: 0.01,
          minProfit: 0.01,
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

test("exposes stable named trading-environment values", () => {
  assert.deepEqual(TRADING_ENVIRONMENTS, { BOTH: "both", TESTNET: "testnet", LIVE: "live" })
  assert.equal(Object.isFrozen(TRADING_ENVIRONMENTS), true, "The shared environment constants must not be mutable.")
})

test("requires an explicit supported tradingEnvironment on every pair", () => {
  for (const tradingEnvironment of Object.values(TRADING_ENVIRONMENTS)) {
    const config = createAppConfig()
    config.strategies.CG_coinGrabber.pairs.ZROFDUSD.tradingEnvironment = tradingEnvironment
    assert.equal(validateAppConfig(config), config, "Each documented pair environment must be accepted explicitly: " + tradingEnvironment)
  }
  const missingEnvironment = createAppConfig()
  delete missingEnvironment.strategies.CG_coinGrabber.pairs.ZROFDUSD.tradingEnvironment
  assert.throws(
    () => validateAppConfig(missingEnvironment),
    (error) => error instanceof ConfigValidationError && error.path === "strategies.CG_coinGrabber.pairs.ZROFDUSD.tradingEnvironment",
    "A pair without tradingEnvironment must fail instead of receiving an implicit default.",
  )
  for (const invalidValue of ["production", "TESTNET", "", null]) {
    const config = createAppConfig()
    config.strategies.CG_coinGrabber.pairs.ZROFDUSD.tradingEnvironment = invalidValue
    assert.throws(
      () => validateAppConfig(config),
      (error) => error instanceof ConfigValidationError && error.path === "strategies.CG_coinGrabber.pairs.ZROFDUSD.tradingEnvironment",
      "Unsupported pair environments must fail validation: " + JSON.stringify(invalidValue),
    )
  }
})

test("validates strategy-owned pairs without requiring exchange-mode configuration in JSON", () => {
  const config = createAppConfig()
  assert.equal(validateAppConfig(config), config, "Strategy and pair settings must remain valid without a runtime profile block.")
  assert.equal(Object.hasOwn(config, "runtime"), false, "Exchange selection must not be stored in config/index.js.")
  assert.equal(config.strategies.CG_coinGrabber.pairs.ZROFDUSD.investment, 100, "The pair investment setting must remain part of strategy configuration.")
})

test("accepts disabled process-restart recovery and rejects enabling the unfinished feature", () => {
  const config = createAppConfig()
  config.strategies.CG_coinGrabber.settings.recovery = { enabled: false }
  assert.equal(validateAppConfig(config), config)

  config.strategies.CG_coinGrabber.settings.recovery.enabled = true
  assert.throws(
    () => validateAppConfig(config),
    (error) => error instanceof ConfigValidationError &&
      error.path === "strategies.CG_coinGrabber.settings.recovery.enabled",
    "Process-restart recovery must remain disabled until its complete readiness and crash/restart gates are accepted.",
  )
})

test("composes raw CG strategy settings and resolves precision from the shared token registry", async () => {
  assert.equal(appConfig.strategies.CG_coinGrabber.settings.recovery.enabled, false)
  for (const pair of Object.values(appConfig.strategies.CG_coinGrabber.pairs)) {
    assert.equal(Object.hasOwn(pair, "pricePrecision"), false, "Operator strategy config must not duplicate exchange-derived price precision.")
    assert.equal(Object.hasOwn(pair, "quantityPrecision"), false, "Operator strategy config must not duplicate exchange-derived quantity precision.")
  }
  const effectiveConfig = await loadAppConfig()
  assert.equal(validateAppConfig(effectiveConfig), effectiveConfig, "The runtime configuration must validate after authoritative market precision is resolved.")
})

test("accepts only ignore or block for each pair's external-order policy", () => {
  const config = createAppConfig()
  const pair = config.strategies.CG_coinGrabber.pairs.ZROFDUSD

  assert.equal(validateAppConfig(config), config, "Omitted policy must retain the default ignore behavior.")
  pair.externalOrdersPolicy = EXTERNAL_ORDERS_POLICIES.IGNORE
  assert.equal(validateAppConfig(config), config)
  pair.externalOrdersPolicy = EXTERNAL_ORDERS_POLICIES.BLOCK
  assert.equal(validateAppConfig(config), config)
  pair.externalOrdersPolicy = "adopt"
  assert.throws(
    () => validateAppConfig(config),
    (error) => error instanceof ConfigValidationError &&
      error.path === "strategies.CG_coinGrabber.pairs.ZROFDUSD.externalOrdersPolicy" &&
      error.expected === "ignore or block",
  )
})


test("requires an explicit per-pair volatility protection boolean", () => {
  const config = createAppConfig()
  const pair = config.strategies.CG_coinGrabber.pairs.ZROFDUSD
  delete pair.enableVolatilityProtection
  assert.throws(() => validateAppConfig(config), (error) =>
    error instanceof ConfigValidationError &&
    error.path === "strategies.CG_coinGrabber.pairs.ZROFDUSD.enableVolatilityProtection" &&
    error.expected === "a boolean",
  "Every pair must explicitly declare whether volatility protection is enabled.")
  pair.enableVolatilityProtection = false
  assert.equal(validateAppConfig(config), config, "An explicit false value must be accepted for an opted-out pair.")
  pair.enableVolatilityProtection = true
  assert.equal(validateAppConfig(config), config, "An explicit true value must retain protection.")
})

test("rejects non-boolean per-pair volatility protection values", () => {
  for (const invalidValue of [null, 0, 1, "false", "true"]) {
    const config = createAppConfig()
    config.strategies.CG_coinGrabber.pairs.ZROFDUSD.enableVolatilityProtection = invalidValue
    assert.throws(() => validateAppConfig(config), (error) =>
      error instanceof ConfigValidationError &&
      error.path === "strategies.CG_coinGrabber.pairs.ZROFDUSD.enableVolatilityProtection" &&
      error.expected === "a boolean",
    "The required volatility setting must reject non-boolean values: " + JSON.stringify(invalidValue))
  }
})

test("requires a minimum-profit threshold on every pair", () => {
  const config = createAppConfig()
  delete config.strategies.CG_coinGrabber.pairs.ZROFDUSD.minProfit
  assert.throws(() => validateAppConfig(config), /pairs.*ZROFDUSD.*minProfit/)
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
  const runtime = resolveRuntimeConfig({ config: createAppConfig(), tradingMode: TRADING_ENVIRONMENTS.TESTNET, environment: "production" })
  assert.equal(runtime.brokerName, "binance", "Binance must remain the fixed broker for TESTNET.")
  assert.equal(runtime.tradingMode, TRADING_ENVIRONMENTS.TESTNET, "TRADING_MODE must select TESTNET independently of NODE_ENV.")
  assert.equal(runtime.tradingEnabled, true, "Trading must be enabled when TESTNET is explicitly selected.")
})

test("selects Binance LIVE from TRADING_MODE even when NODE_ENV says development", () => {
  const runtime = resolveRuntimeConfig({ config: createAppConfig(), tradingMode: TRADING_ENVIRONMENTS.LIVE, environment: "development" })
  assert.equal(runtime.brokerName, "binance", "Binance must remain the fixed broker for LIVE.")
  assert.equal(runtime.tradingMode, TRADING_ENVIRONMENTS.LIVE, "TRADING_MODE must select LIVE independently of NODE_ENV.")
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
      `An invalid exchange mode must fail startup instead of falling back to another environment: ${JSON.stringify(tradingMode)}`,
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
    (error) => error instanceof ConfigValidationError && error instanceof TypeError && error.message.startsWith("Invalid app config"),
    "Configuration validation errors must identify the generic app config, not the application name or trading domain.",
  )
})

test("accepts omitted operator-control configuration as disabled", () => {
  const config = createAppConfig()
  assert.equal(validateAppConfig(config), config, "Existing configurations without inbound operator control must remain valid and disabled.")
})

test("accepts explicitly disabled Telegram operator control without an allowlist", () => {
  const config = createAppConfig()
  config.operatorControl = { telegram: { enabled: false, allowedUserIds: [] } }
  assert.equal(validateAppConfig(config), config, "Disabled inbound control must not require credentials or trusted users.")
})

test("allows bootstrap to supply the trusted Telegram user ID from the runtime environment", () => {
  const config = createAppConfig()
  config.operatorControl = { telegram: { enabled: true, allowedUserIds: [] } }
  assert.equal(validateAppConfig(config), config)
})

test("rejects malformed or duplicate Telegram operator user IDs", () => {
  for (const allowedUserIds of [["0"], ["01"], ["-1"], ["not-a-user"], [12345], ["12345", "12345"]]) {
    const config = createAppConfig()
    config.operatorControl = { telegram: { enabled: false, allowedUserIds } }
    assert.throws(
      () => validateAppConfig(config),
      (error) => error instanceof ConfigValidationError &&
        error.path === "operatorControl.telegram.allowedUserIds",
      `Operator allowlists must contain unique canonical positive decimal string IDs: ${JSON.stringify(allowedUserIds)}`,
    )
  }
})

test("accepts an enabled Telegram operator allowlist with canonical user IDs", () => {
  const config = createAppConfig()
  config.operatorControl = { telegram: { enabled: true, allowedUserIds: ["12345", "67890"] } }
  assert.equal(validateAppConfig(config), config, "A valid explicit private-user allowlist must enable the inbound adapter.")
})

test("rejects malformed operator-control configuration and unknown Telegram fields", () => {
  const invalidEnabled = createAppConfig()
  invalidEnabled.operatorControl = { telegram: { enabled: "true", allowedUserIds: ["12345"] } }
  assert.throws(
    () => validateAppConfig(invalidEnabled),
    (error) => error instanceof ConfigValidationError &&
      error.path === "operatorControl.telegram.enabled",
    "The inbound-control switch must be a boolean, never a truthy string.",
  )

  const unknownField = createAppConfig()
  unknownField.operatorControl = { telegram: { enabled: false, allowedUserIds: [], chatId: "12345" } }
  assert.throws(
    () => validateAppConfig(unknownField),
    (error) => error instanceof ConfigValidationError &&
      error.path === "operatorControl.telegram.chatId",
    "The inbound-control configuration must reject unsupported fields and keep Telegram identity policy explicit.",
  )
})



test("uses one named immutable source for supported external-order policy values", () => {
  assert.deepEqual(
    EXTERNAL_ORDERS_POLICIES,
    { IGNORE: "ignore", BLOCK: "block" },
    "The supported manual/external order policies must have stable serialized values.",
  )
  assert.equal(
    Object.isFrozen(EXTERNAL_ORDERS_POLICIES),
    true,
    "Consumers must not be able to mutate the shared external-order policy identifiers.",
  )
})

test("composes the named operator-control defaults into the single application config", () => {
  assert.equal(
    appConfig.operatorControl,
    OPERATOR_CONTROL_CONFIG,
    "The application config must import the focused operator-control module rather than duplicate its settings.",
  )
  assert.equal(
    OPERATOR_CONTROL_CONFIG.telegram.enabled,
    false,
    "Inbound Telegram operator control must remain disabled by default.",
  )
  assert.deepEqual(
    OPERATOR_CONTROL_CONFIG.telegram.allowedUserIds,
    [],
    "The operator allowlist must remain empty until explicitly configured.",
  )
})
