import nodeTest from "node:test"
import assert from "node:assert/strict"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { resolveHarvesterOptions } from "./resolve-harvester-options.js"

const test = (name, ...args) => nodeTest("[resolve-harvester-options.test.js] " + name, ...args)

const config = ({ enabledSymbols = ["BTCUSDT"], conservative = true, aggressive = false } = {}) => ({
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: {
        conservative: { enabled: conservative },
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

test("resolves read-only mode and publishes the validated configuration event", async () => {
  const fixture = createFixture()
  const result = await resolveHarvesterOptions(fixture.input)

  assert.equal(result.tradingEnabled, false, "Trading must remain disabled unless explicitly requested with a broker.")
  assert.deepEqual(result.enabledSymbols, ["BTCUSDT"], "Only enabled market symbols must be returned.")
  assert.equal(fixture.events[0].name, HARVESTER_EVENT_NAMES.CONFIG_VALIDATED, "Configuration validation must publish lifecycle evidence.")
  assert.equal(fixture.events[0].data.strategyMode, "read-only", "The event must report read-only mode.")
})

test("allows trading only with Binance, enabled markets, TESTNET mode, and non-production environment", async () => {
  const fixture = createFixture({
    env: {
      HARVESTER_BROKER: "binance",
      HARVESTER_ENABLE_TRADING: "true",
      HARVESTER_TRADING_MODE: "testnet",
      NODE_ENV: "test",
    },
  })
  const result = await resolveHarvesterOptions(fixture.input)

  assert.equal(result.tradingEnabled, true, "All explicit TESTNET gates must be required before enabling trading.")
  assert.equal(fixture.events[0].data.tradingEnabled, true, "The lifecycle event must reflect the resolved trading mode.")
})

test("rejects trading without an enabled market or Binance broker", async () => {
  const noMarkets = createFixture({
    cfg: config({ enabledSymbols: [] }),
    env: { HARVESTER_BROKER: "binance", HARVESTER_ENABLE_TRADING: "true", HARVESTER_TRADING_MODE: "testnet", NODE_ENV: "test" },
  })
  await assert.rejects(
    resolveHarvesterOptions(noMarkets.input),
    /requires at least one enabled pair/,
    "Trading must not start without an enabled market.",
  )

  const noBroker = createFixture({
    env: { HARVESTER_ENABLE_TRADING: "true", HARVESTER_TRADING_MODE: "testnet", NODE_ENV: "test" },
  })
  await assert.rejects(
    resolveHarvesterOptions(noBroker.input),
    /HARVESTER_BROKER=binance is required/,
    "Trading must require an explicit Binance broker.",
  )
})

test("rejects unsafe production/live trading configuration and invalid strategy flags", async () => {
  const unsafe = createFixture({
    env: { HARVESTER_BROKER: "binance", HARVESTER_ENABLE_TRADING: "true", HARVESTER_TRADING_MODE: "live", NODE_ENV: "production" },
  })
  await assert.rejects(resolveHarvesterOptions(unsafe.input), /requires HARVESTER_TRADING_MODE=testnet/)

  const aggressive = createFixture({ cfg: config({ aggressive: true }) })
  await assert.rejects(resolveHarvesterOptions(aggressive.input), /Aggressive strategy is disabled and deferred/)
})
