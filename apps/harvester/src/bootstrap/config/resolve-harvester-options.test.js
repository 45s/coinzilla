import nodeTest from "node:test"
import assert from "node:assert/strict"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { TRADING_ENVIRONMENTS } from "../../domain/trading-environment.js"
import { appConfig as defaultAppConfig } from "../../../config/index.js"
import { resolveHarvesterOptions } from "./resolve-harvester-options.js"

const test = (...args) => nodeTest(`[resolve-harvester-options.test.js] ${args[0]}`, ...args.slice(1))

const config = ({
  enabledSymbols = ["BTCUSDT"],
  conservative = true,
  aggressive = false,
} = {}) => ({
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: { conservative: { enabled: conservative },
        aggressive: { enabled: aggressive },
      },
      pairs: Object.fromEntries(enabledSymbols.map((symbol) => [symbol, { enabled: true,
tradingEnvironment: TRADING_ENVIRONMENTS.BOTH }])),
    },
  },
})

const createFixture = ({ cfg = config(), env = {} } = {}) => {
  const events = []
  return {
    events,
    input: {
      configSource: "test-config",
      loadConfig: async (source) => {
        assert.equal(source, "test-config", "The configured source must be passed to the config loader.")
        return cfg
      },
      env,
      eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
      logger: {},
    },
  }
}

function recoverySellerPair(overrides = {}) {
  return {
    enabled: true,
    tradingEnvironment: TRADING_ENVIRONMENTS.BOTH,
    enableVolatilityProtection: false,
    externalOrdersPolicy: "BLOCK",
    investment: 100,
    orderQuantity: 5,
    minProfit: 1,
    priceStepPercent: 1,
    makerPercent: 0,
    takerPercent: 0.1,
    pricePrecision: 4,
    quantityPrecision: 4,
    legacyPosition: {
      invested: 50,
      quantity: 10,
    },
    sellQuantity: 5,
    ...overrides,
  }
}

test("selects CG and RS markets independently while preserving strategy-owned pair maps", async () => {


  const cfg = {
    ...config({ enabledSymbols: ["BTCUSDT"] }),
    strategies: {
      ...config({ enabledSymbols: ["BTCUSDT"] }).strategies,
      RS_recoverySeller: {
        enabled: true,
        pairs: {
          ETHUSDT: recoverySellerPair(),
        },
      },
    },
  }
  const executionRoutes = [
    {
      strategyId: "CG_coinGrabber",
      symbol: "BTCUSDT",
    },
    {
      strategyId: "RS_recoverySeller",
      symbol: "ETHUSDT",
    },
  ]
  const executionSymbols = ["BTCUSDT", "ETHUSDT"]
  const fixture = createFixture({
    cfg,
    env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET },
  })
  const result = await resolveHarvesterOptions({
    ...fixture.input,
    executionSymbols,
    executionRoutes,
  })

  assert.deepEqual(Object.keys(result.appConfig.strategies.CG_coinGrabber.pairs), ["BTCUSDT"])
  assert.deepEqual(Object.keys(result.appConfig.strategies.RS_recoverySeller.pairs), ["ETHUSDT"])
  assert.deepEqual(Object.keys(result.pairs), ["BTCUSDT", "ETHUSDT"])
  assert.deepEqual(result.marketSymbols, ["BTCUSDT", "ETHUSDT"])
  assert.deepEqual(result.executionSymbols, ["BTCUSDT", "ETHUSDT"])
  assert.deepEqual(result.executionRoutes, executionRoutes)
  assert.deepEqual(result.marketPriceStrategyIds, {
    BTCUSDT: "CG_coinGrabber",
    ETHUSDT: "RS_recoverySeller",
  }, "Resolved market-price diagnostics must retain the explicit execution owner for each market.")
})

test("rejects conflicting volatility settings for a market routed to CG and RS", async () => {
  const cfg = config({ enabledSymbols: ["BTCUSDT"] })
  cfg.strategies.CG_coinGrabber.pairs.BTCUSDT.enableVolatilityProtection = true
  cfg.strategies.RS_recoverySeller = {
    enabled: true,
    pairs: {
      BTCUSDT: recoverySellerPair({ enableVolatilityProtection: false }),
    },
  }
  const fixture = createFixture({
    cfg,
    env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET },
  })

  await assert.rejects(
    resolveHarvesterOptions({
      ...fixture.input,
      executionSymbols: ["BTCUSDT"],
      executionRoutes: [
        {
          strategyId: "CG_coinGrabber",
          symbol: "BTCUSDT",
        },
        {
          strategyId: "RS_recoverySeller",
          symbol: "BTCUSDT",
        },
      ],
    }),
    /conflicting volatility protection settings for CG and RS/i,
  )
})

test("rejects an RS route unless the RS strategy is explicitly enabled", async () => {
  const fixture = createFixture({
    cfg: {
      ...config(),
      strategies: {
        ...config().strategies,
        RS_recoverySeller: {
          enabled: false,
          pairs: {
            ETHUSDT: recoverySellerPair(),
          },
        },
      },
    },
    env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET },
  })

  await assert.rejects(
    resolveHarvesterOptions({
      ...fixture.input,
      executionSymbols: ["BTCUSDT", "ETHUSDT"],
      executionRoutes: [
        {
          strategyId: "CG_coinGrabber",
          symbol: "BTCUSDT",
        },
        {
          strategyId: "RS_recoverySeller",
          symbol: "ETHUSDT",
        },
      ],
    }),
    /RS_recoverySeller strategy must be explicitly enabled/i,
  )
})

test("resolves an RS-only provider account without creating a Conservative execution route", async () => {
  const cfg = {
    ...config({ enabledSymbols: ["BTCUSDT"] }),
    strategies: {
      ...config({ enabledSymbols: ["BTCUSDT"] }).strategies,
      RS_recoverySeller: {
        enabled: true,
        pairs: {
          ETHUSDT: recoverySellerPair(),
        },
      },
    },
  }
  const fixture = createFixture({
    cfg,
    env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET },
  })
  const result = await resolveHarvesterOptions({
    ...fixture.input,
    executionSymbols: ["ETHUSDT"],
    executionRoutes: [{
      strategyId: "RS_recoverySeller",
      symbol: "ETHUSDT",
    }],
  })

  assert.deepEqual(result.conservativePairs, {}, "An RS-only provider must not receive a synthetic Conservative market.")
  assert.deepEqual(Object.keys(result.recoverySellerPairs), ["ETHUSDT"], "The RS provider must receive only its explicitly routed RS pair.")
  assert.deepEqual(Object.keys(result.pairs), ["ETHUSDT"], "The provider market map must contain the RS market without adding it to CG.")
  assert.deepEqual(result.executionSymbols, ["ETHUSDT"], "The RS route must remain executable on the selected provider.")
  assert.equal(result.tradingEnabled, true, "An enabled RS route must not be disabled merely because this account has no CG route.")
  assert.deepEqual(result.marketPriceStrategyIds, {
    ETHUSDT: "RS_recoverySeller",
  }, "RS-only market-price diagnostics must use the RS execution route.")
})

test("rejects duplicate Conservative strategy routes before selecting runtime pairs", async () => {
  const fixture = createFixture({
    env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET },
  })

  await assert.rejects(
    resolveHarvesterOptions({
      ...fixture.input,
      executionSymbols: ["BTCUSDT"],
      executionRoutes: [
        {
          strategyId: "CG_coinGrabber",
          symbol: "BTCUSDT",
        },
        {
          strategyId: "CG_coinGrabber",
          symbol: "BTCUSDT",
        },
      ],
    }),
    /duplicate CG market/i,
  )
})

test("requires an explicit TRADING_MODE before publishing validated configuration", async () => {
  const fixture = createFixture()
  await assert.rejects(
    resolveHarvesterOptions(fixture.input),
    /TRADING_MODE must be set to "testnet" or "live"/,
    "Missing exchange mode must stop startup before configuration is reported as validated.",
  )
  assert.equal(fixture.events.length, 0, "Invalid environment configuration must not publish config.validated.")
})

test("adds the validated TELEGRAM_USER_ID to the resolved operator allowlist", async () => {
  const cfg = {
    ...config(),
    operatorControl: { telegram: { enabled: true,
allowedUserIds: [] } },
  }
  const fixture = createFixture({ cfg,
env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET,
TELEGRAM_USER_ID: "123456789" } })
  const result = await resolveHarvesterOptions(fixture.input)
  assert.deepEqual(result.appConfig.operatorControl.telegram.allowedUserIds, ["123456789"])
  assert.deepEqual(cfg.operatorControl.telegram.allowedUserIds, [], "Resolving the environment ID must not mutate loaded configuration.")
})

test("rejects invalid TELEGRAM_USER_ID before publishing validated configuration", async () => {
  const fixture = createFixture({ env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET,
TELEGRAM_USER_ID: "not-a-number" } })
  await assert.rejects(
    resolveHarvesterOptions(fixture.input),
    (error) => error.code === "TELEGRAM_USER_ID_INVALID" && error.message.includes("TELEGRAM_USER_ID"),
  )
  assert.equal(fixture.events.length, 0, "Invalid Telegram identity must fail before config.validated is published.")
})

test("selects TESTNET and enables trading even when NODE_ENV is production", async () => {
  const fixture = createFixture({ env: { NODE_ENV: "production",
TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET } })
  const result = await resolveHarvesterOptions(fixture.input)
  assert.equal(result.tradingEnabled, true, "An explicit TESTNET mode must enable trading.")
  assert.equal(result.brokerName, "binance", "Binance must be selected without a broker selector.")
  assert.equal(result.tradingMode, TRADING_ENVIRONMENTS.TESTNET, "NODE_ENV must not override TRADING_MODE.")
  assert.deepEqual(result.enabledSymbols, ["BTCUSDT"], "Only enabled market symbols must be returned.")
  assert.equal(fixture.events[0].name, HARVESTER_EVENT_NAMES.CONFIG_VALIDATED, "Successful validation must publish the lifecycle event.")
})

test("selects LIVE and enables trading even when NODE_ENV is development", async () => {
  const fixture = createFixture({ env: { NODE_ENV: "development",
TRADING_MODE: TRADING_ENVIRONMENTS.LIVE } })
  const result = await resolveHarvesterOptions(fixture.input)
  assert.equal(result.brokerName, "binance", "LIVE mode must use the fixed Binance broker.")
  assert.equal(result.tradingMode, TRADING_ENVIRONMENTS.LIVE, "NODE_ENV must not override the explicit LIVE mode.")
  assert.equal(result.tradingEnabled, true, "Selecting LIVE must enable real order execution.")
})

test("fingerprints effective per-market settings and publishes the matching enabled-market set", async () => {
  const cfg = config({ enabledSymbols: ["BTCUSDT", "ETHUSDT"] })
  cfg.strategies.CG_coinGrabber.pairs.BTCUSDT.investment = 100
  cfg.strategies.CG_coinGrabber.pairs.ETHUSDT.enabled = false
  const fixture = createFixture({ cfg,
env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET } })
  const result = await resolveHarvesterOptions(fixture.input)

  assert.match(result.configurationFingerprint, /^[a-f0-9]{64}$/,
    "Effective strategy configuration must produce a deterministic SHA-256 fingerprint.")
  assert.equal(fixture.events[0].data.configurationFingerprint, result.configurationFingerprint,
    "The validated Journal event must carry the exact effective configuration fingerprint.")
  assert.deepEqual(fixture.events[0].data.enabledMarkets, result.enabledSymbols,
    "The recorded enabled-market set must match the runtime-selected markets.")

  const changedConfig = config({ enabledSymbols: ["BTCUSDT", "ETHUSDT"] })
  changedConfig.strategies.CG_coinGrabber.pairs.BTCUSDT.investment = 101
  changedConfig.strategies.CG_coinGrabber.pairs.ETHUSDT.enabled = false
  const changed = await resolveHarvesterOptions(createFixture({
    cfg: changedConfig,
    env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET },
  }).input)
  assert.notEqual(changed.configurationFingerprint, result.configurationFingerprint,
    "Changing an effective per-market strategy setting must change the fingerprint.")
})

test("fails closed rather than fingerprinting secret-bearing strategy settings", async () => {
  const cfg = config()
  cfg.strategies.CG_coinGrabber.pairs.BTCUSDT.apiKey = "must-not-be-recorded"
  const fixture = createFixture({ cfg,
env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET } })
  await assert.rejects(
    resolveHarvesterOptions(fixture.input),
    (error) => error.code === "HARVESTER_EFFECTIVE_CONFIGURATION_INVALID",
    "A strategy configuration containing credentials must not be fingerprinted or reported as validated.",
  )
  assert.equal(fixture.events.length, 0, "Invalid evidence must fail before config.validated is published.")
})

test("rejects an invalid TRADING_MODE", async () => {
  const fixture = createFixture({ env: { TRADING_MODE: "production" } })
  await assert.rejects(
    resolveHarvesterOptions(fixture.input),
    /TRADING_MODE must be set to "testnet" or "live"/,
    "Only the exact supported exchange-mode values may pass startup validation.",
  )
})

test("selects only matching pairs and strips tradingEnvironment before runtime", async () => {
  const cfg = config({ enabledSymbols: ["BTCUSDT", "ETHUSDT", "DOGEUSDT"] })
  const { pairs } = cfg.strategies.CG_coinGrabber
  pairs.BTCUSDT.tradingEnvironment = TRADING_ENVIRONMENTS.TESTNET
  pairs.ETHUSDT.tradingEnvironment = TRADING_ENVIRONMENTS.LIVE
  pairs.DOGEUSDT.tradingEnvironment = TRADING_ENVIRONMENTS.BOTH
  pairs.DOGEUSDT.enabled = false

  const testnet = await resolveHarvesterOptions(createFixture({ cfg,
env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET } }).input)
  assert.deepEqual(Object.keys(testnet.pairs), ["BTCUSDT", "DOGEUSDT"], "TESTNET must include testnet-only and both pairs, but exclude live-only pairs.")
  assert.deepEqual(testnet.enabledSymbols, ["BTCUSDT"], "The enabled flag must remain independent of environment eligibility.")
  assert.equal(Object.hasOwn(testnet.pairs.BTCUSDT, "tradingEnvironment"), false, "The selector must be removed from runtime pair settings.")
  assert.equal(Object.hasOwn(testnet.appConfig.strategies.CG_coinGrabber.pairs.BTCUSDT, "tradingEnvironment"), false, "The effective appConfig must expose only the existing runtime pair shape.")
  assert.deepEqual(testnet.appConfig.strategies.CG_coinGrabber.pairs, testnet.pairs, "The effective appConfig and returned pairs must use the same filtered runtime map.")

  const live = await resolveHarvesterOptions(createFixture({ cfg,
env: { TRADING_MODE: TRADING_ENVIRONMENTS.LIVE } }).input)
  assert.deepEqual(Object.keys(live.pairs), ["ETHUSDT", "DOGEUSDT"], "LIVE must include live-only and both pairs, but exclude testnet-only pairs.")
  assert.deepEqual(live.enabledSymbols, ["ETHUSDT"], "Disabled both-environment pairs must remain configured but not become enabled.")
  assert.notEqual(testnet.configurationFingerprint, live.configurationFingerprint,
    "The fingerprint must reflect the effective trading-mode-filtered strategy configuration.")
  assert.equal(Object.hasOwn(live.pairs.ETHUSDT, "tradingEnvironment"), false, "LIVE runtime pair settings must also omit the selector.")
})

test("does not fall back when no pair matches TRADING_MODE", async () => {
  const cfg = config()
  cfg.strategies.CG_coinGrabber.pairs.BTCUSDT.tradingEnvironment = TRADING_ENVIRONMENTS.LIVE
  await assert.rejects(
    resolveHarvesterOptions(createFixture({ cfg,
env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET } }).input),
    /No CG_coinGrabber pairs configured for TRADING_MODE=testnet/i,
    "A mode with no eligible pairs must fail instead of falling back to the other environment.",
  )
})

test("rejects a pair without an explicit tradingEnvironment before startup", async () => {
  const cfg = config()
  delete cfg.strategies.CG_coinGrabber.pairs.BTCUSDT.tradingEnvironment
  await assert.rejects(
    resolveHarvesterOptions(createFixture({ cfg,
env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET } }).input),
    /tradingEnvironment/i,
    "Runtime pair selection must not infer an environment for an incomplete supplied config.",
  )
})

test("rejects configurations without an enabled pair", async () => {
  const cfg = config({ enabledSymbols: ["BTCUSDT"] })
  cfg.strategies.CG_coinGrabber.pairs.BTCUSDT.enabled = false
  const fixture = createFixture({
    cfg,
    env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET },
  })
  await assert.rejects(
    resolveHarvesterOptions(fixture.input),
    (error) => error.code === "HARVESTER_EFFECTIVE_CONFIGURATION_INVALID" &&
      error.expected === "at least one enabled market",
    "Trading must not start when the strategy has no enabled market.",
  )
})

test("rejects invalid strategy flags", async () => {
  const aggressive = createFixture({
    cfg: config({ aggressive: true }),
    env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET },
  })
  await assert.rejects(resolveHarvesterOptions(aggressive.input), /Aggressive strategy is disabled and deferred/)
  const conservative = createFixture({
    cfg: config({ conservative: false }),
    env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET },
  })
  await assert.rejects(resolveHarvesterOptions(conservative.input), /Conservative strategy must remain enabled/)
})


test("resolves RS-only provider routes when Conservative has no configured markets", async () => {
  const cfg = {
    ...config({ enabledSymbols: [] }),
    strategies: {
      ...config({ enabledSymbols: [] }).strategies,
      RS_recoverySeller: {
        enabled: true,
        pairs: {
          ETHUSDT: recoverySellerPair(),
        },
      },
    },
  }
  const fixture = createFixture({
    cfg,
    env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET },
  })
  const result = await resolveHarvesterOptions({
    ...fixture.input,
    executionSymbols: ["ETHUSDT"],
    executionRoutes: [{
      strategyId: "RS_recoverySeller",
      symbol: "ETHUSDT",
    }],
  })

  assert.deepEqual(result.conservativePairs, {})
  assert.deepEqual(result.recoverySellerPairs, { ETHUSDT: Object.fromEntries(Object.entries(recoverySellerPair()).filter(([key]) => key !== "tradingEnvironment")) })
  assert.deepEqual(result.pairs, result.recoverySellerPairs)
  assert.equal(result.tradingEnabled, true)
})


test("does not assign a strategy owner when both strategies explicitly route the same market", async () => {
  const cfg = {
    ...config(),
    strategies: {
      ...config().strategies,
      RS_recoverySeller: {
        enabled: true,
        pairs: {
          BTCUSDT: recoverySellerPair(),
        },
      },
    },
  }
  const fixture = createFixture({
    cfg,
    env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET },
  })
  const result = await resolveHarvesterOptions({
    ...fixture.input,
    executionSymbols: ["BTCUSDT"],
    executionRoutes: [
      {
        strategyId: "CG_coinGrabber",
        symbol: "BTCUSDT",
      },
      {
        strategyId: "RS_recoverySeller",
        symbol: "BTCUSDT",
      },
    ],
  })

  assert.deepEqual(result.marketPriceStrategyIds, {
    BTCUSDT: null,
  }, "A market with multiple execution owners must remain unattributed rather than choosing CG or RS.")
})

test("retains CG ownership for the legacy single-strategy route", async () => {
  const result = await resolveHarvesterOptions(createFixture({
    env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET },
  }).input)

  assert.deepEqual(result.marketPriceStrategyIds, {
    BTCUSDT: "CG_coinGrabber",
  }, "The existing CG-only startup path must keep its canonical strategy attribution.")
})

test("resolves the configured default LINEA and ARB RS markets when CG process recovery is disabled", async () => {
  const cfg = structuredClone(defaultAppConfig)
  cfg.components = {
    ...cfg.components,
    recovery: { enabled: false },
  }
  const executionRoutes = [
    {
      strategyId: "RS_recoverySeller",
      symbol: "LINEAUSDT",
    },
    {
      strategyId: "RS_recoverySeller",
      symbol: "ARBUSDT",
    },
  ]
  const fixture = createFixture({
    cfg,
    env: {
      TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET,
      TELEGRAM_USER_ID: "123456789",
    },
  })
  const result = await resolveHarvesterOptions({
    ...fixture.input,
    executionSymbols: ["LINEAUSDT", "ARBUSDT"],
    executionRoutes,
    marketDataSymbols: ["LINEAUSDT", "ARBUSDT"],
  })

  assert.equal(result.appConfig.strategies.RS_recoverySeller.enabled, true,
    "The default enabled RS strategy must remain enabled with CG process recovery disabled.")
  assert.deepEqual(Object.keys(result.recoverySellerPairs), ["LINEAUSDT", "ARBUSDT"],
    "Both default TESTNET RS markets must survive configuration resolution.")
  assert.deepEqual(result.executionRoutes, executionRoutes,
    "The exact RS strategy/market routes must be retained.")
  assert.deepEqual(result.executionSymbols, ["LINEAUSDT", "ARBUSDT"],
    "The resolved provider market set must retain both RS markets.")
  assert.deepEqual(result.enabledSymbols, ["ARBUSDT", "LINEAUSDT"],
    "Runtime configuration evidence must include both enabled RS markets.")
})

test("rejects enabled RS configuration when provider execution routes are missing", async () => {
  const baseConfig = config({ enabledSymbols: ["BTCUSDT"] })
  const cfg = {
    ...baseConfig,
    strategies: {
      ...baseConfig.strategies,
      RS_recoverySeller: {
        enabled: true,
        pairs: { ETHUSDT: recoverySellerPair() },
      },
    },
  }
  const fixture = createFixture({
    cfg,
    env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET },
  })

  await assert.rejects(
    () => resolveHarvesterOptions({
      ...fixture.input,
      executionSymbols: ["BTCUSDT"],
    }),
    /Enabled RS markets require explicit strategy\/market execution routes/,
    "Enabled RS markets must fail closed instead of silently disappearing when provider routes are absent.",
  )
})

test("keeps enabled RS execution routes when CG process recovery is disabled", async () => {
  const conservativeSymbols = ["ADAUSDT", "DOGEUSDT", "LINKUSDT", "ZROUSDT"]
  const recoverySellerSymbols = ["LINEAUSDT", "ARBUSDT"]
  const baseConfig = config({ enabledSymbols: conservativeSymbols })
  const cfg = {
    ...baseConfig,
    components: { recovery: { enabled: false } },
    strategies: {
      ...baseConfig.strategies,
      RS_recoverySeller: {
        enabled: true,
        pairs: Object.fromEntries(recoverySellerSymbols.map((symbol) => [
          symbol,
          recoverySellerPair(),
        ])),
      },
    },
  }
  const fixture = createFixture({
    cfg,
    env: { TRADING_MODE: TRADING_ENVIRONMENTS.TESTNET },
  })
  const executionRoutes = [
    ...conservativeSymbols.map((symbol) => ({
      strategyId: "CG_coinGrabber",
      symbol,
    })),
    ...recoverySellerSymbols.map((symbol) => ({
      strategyId: "RS_recoverySeller",
      symbol,
    })),
  ]
  const executionSymbols = [...conservativeSymbols, ...recoverySellerSymbols]
  const result = await resolveHarvesterOptions({
    ...fixture.input,
    executionSymbols,
    executionRoutes,
  })

  assert.equal(result.appConfig.strategies.RS_recoverySeller.enabled, true,
    "The CG process-recovery switch must not disable the independent RS strategy.")
  assert.deepEqual(Object.keys(result.appConfig.strategies.RS_recoverySeller.pairs), recoverySellerSymbols,
    "The enabled RS market must remain in the effective runtime configuration.")
  assert.deepEqual(Object.keys(result.recoverySellerPairs), recoverySellerSymbols,
    "The RS market must survive strategy pair resolution.")
  assert.deepEqual(result.executionRoutes, executionRoutes,
    "The provider's CG and RS execution routes must both be retained.")
  assert.deepEqual(result.executionSymbols, executionSymbols,
    "The provider's CG and RS execution symbols must both be retained.")
  assert.deepEqual(result.enabledSymbols, [...conservativeSymbols, ...recoverySellerSymbols].sort(),
    "Configuration evidence must include enabled markets from both strategies.")
})
