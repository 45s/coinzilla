import nodeTest from "node:test"
import assert from "node:assert/strict"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { resolveHarvesterOptions } from "./resolve-harvester-options.js"

const test = (name, ...args) => nodeTest("[resolve-harvester-options.test.js] " + name, ...args)

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
      pairs: Object.fromEntries(enabledSymbols.map((symbol) => [symbol, { enabled: true }])),
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
    operatorControl: { telegram: { enabled: true, allowedUserIds: [] } },
  }
  const fixture = createFixture({ cfg, env: { TRADING_MODE: "testnet", TELEGRAM_USER_ID: "123456789" } })
  const result = await resolveHarvesterOptions(fixture.input)
  assert.deepEqual(result.appConfig.operatorControl.telegram.allowedUserIds, ["123456789"])
  assert.deepEqual(cfg.operatorControl.telegram.allowedUserIds, [], "Resolving the environment ID must not mutate loaded configuration.")
})

test("rejects invalid TELEGRAM_USER_ID before publishing validated configuration", async () => {
  const fixture = createFixture({ env: { TRADING_MODE: "testnet", TELEGRAM_USER_ID: "not-a-number" } })
  await assert.rejects(
    resolveHarvesterOptions(fixture.input),
    (error) => error.code === "TELEGRAM_USER_ID_INVALID" && error.message.includes("TELEGRAM_USER_ID"),
  )
  assert.equal(fixture.events.length, 0, "Invalid Telegram identity must fail before config.validated is published.")
})

test("selects TESTNET and enables trading even when NODE_ENV is production", async () => {
  const fixture = createFixture({ env: { NODE_ENV: "production", TRADING_MODE: "testnet" } })
  const result = await resolveHarvesterOptions(fixture.input)
  assert.equal(result.tradingEnabled, true, "An explicit TESTNET mode must enable trading.")
  assert.equal(result.brokerName, "binance", "Binance must be selected without a broker selector.")
  assert.equal(result.tradingMode, "testnet", "NODE_ENV must not override TRADING_MODE.")
  assert.deepEqual(result.enabledSymbols, ["BTCUSDT"], "Only enabled market symbols must be returned.")
  assert.equal(fixture.events[0].name, HARVESTER_EVENT_NAMES.CONFIG_VALIDATED, "Successful validation must publish the lifecycle event.")
})

test("selects LIVE and enables trading even when NODE_ENV is development", async () => {
  const fixture = createFixture({ env: { NODE_ENV: "development", TRADING_MODE: "live" } })
  const result = await resolveHarvesterOptions(fixture.input)
  assert.equal(result.brokerName, "binance", "LIVE mode must use the fixed Binance broker.")
  assert.equal(result.tradingMode, "live", "NODE_ENV must not override the explicit LIVE mode.")
  assert.equal(result.tradingEnabled, true, "Selecting LIVE must enable real order execution.")
})

test("rejects an invalid TRADING_MODE", async () => {
  const fixture = createFixture({ env: { TRADING_MODE: "production" } })
  await assert.rejects(
    resolveHarvesterOptions(fixture.input),
    /TRADING_MODE must be set to "testnet" or "live"/,
    "Only the exact supported exchange-mode values may pass startup validation.",
  )
})

test("rejects configurations without an enabled pair", async () => {
  const fixture = createFixture({ cfg: config({ enabledSymbols: [] }), env: { TRADING_MODE: "testnet" } })
  await assert.rejects(
    resolveHarvesterOptions(fixture.input),
    /requires at least one enabled pair/,
    "Trading must not start when the strategy has no enabled market.",
  )
})

test("rejects invalid strategy flags", async () => {
  const aggressive = createFixture({ cfg: config({ aggressive: true }), env: { TRADING_MODE: "testnet" } })
  await assert.rejects(resolveHarvesterOptions(aggressive.input), /Aggressive strategy is disabled and deferred/)
  const conservative = createFixture({ cfg: config({ conservative: false }), env: { TRADING_MODE: "testnet" } })
  await assert.rejects(resolveHarvesterOptions(conservative.input), /Conservative strategy must remain enabled/)
})
