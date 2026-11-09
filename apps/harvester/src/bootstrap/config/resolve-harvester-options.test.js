import nodeTest from "node:test"
import assert from "node:assert/strict"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { resolveHarvesterOptions } from "./resolve-harvester-options.js"

const test = (name, ...args) => nodeTest("[resolve-harvester-options.test.js] " + name, ...args)

const config = ({
  enabledSymbols = ["BTCUSDT"],
  conservative = true,
  aggressive = false,
  runtimeProfiles = {},
} = {}) => ({
  runtime: {
    profiles: {
      default: { broker: null, trading: { enabled: false, mode: "testnet" } },
      development: { broker: "binance", trading: { enabled: true, mode: "testnet" } },
      test: { broker: "binance", trading: { enabled: false, mode: "testnet" } },
      production: { broker: "binance", trading: { enabled: true, mode: "live" } },
      ...runtimeProfiles,
    },
  },
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

test("resolves the safe default profile and publishes the validated configuration event", async () => {
  const fixture = createFixture()
  const result = await resolveHarvesterOptions(fixture.input)

  assert.equal(result.tradingEnabled, false, "Trading must remain disabled unless an environment profile explicitly enables TESTNET.")
  assert.equal(result.brokerName, undefined, "An unspecified environment must not silently connect to an exchange.")
  assert.deepEqual(result.enabledSymbols, ["BTCUSDT"], "Only enabled market symbols must be returned.")
  assert.equal(fixture.events[0].name, HARVESTER_EVENT_NAMES.CONFIG_VALIDATED, "Configuration validation must publish the lifecycle event.")
  assert.equal(fixture.events[0].data.strategyMode, "read-only", "The event must report read-only mode.")
})

test("allows trading only with Binance, enabled markets, TESTNET mode, and development environment", async () => {
  const fixture = createFixture({ env: { NODE_ENV: "development" } })
  const result = await resolveHarvesterOptions(fixture.input)

  assert.equal(result.tradingEnabled, true, "The development profile must explicitly enable TESTNET execution.")
  assert.equal(result.brokerName, "binance", "The selected profile must resolve the broker.")
  assert.equal(result.tradingMode, "testnet", "The selected profile must resolve the exchange mode.")
  assert.equal(fixture.events[0].data.tradingEnabled, true, "The lifecycle event must reflect the resolved trading mode.")
})

test("rejects TESTNET trading without an enabled market or Binance broker", async () => {
  const noMarkets = createFixture({
    cfg: config({ enabledSymbols: [] }),
    env: { NODE_ENV: "development" },
  })
  await assert.rejects(
    resolveHarvesterOptions(noMarkets.input),
    /requires at least one enabled pair/,
    "Trading must not start without an enabled market.",
  )

  const noBroker = createFixture({
    cfg: config({
      runtimeProfiles: {
        development: { broker: null, trading: { enabled: true, mode: "testnet" } },
      },
    }),
    env: { NODE_ENV: "development" },
  })
  await assert.rejects(
    resolveHarvesterOptions(noBroker.input),
    /runtime profile broker=binance/,
    "Trading must require an explicit Binance broker in the selected profile.",
  )
})

test("enables production Binance LIVE order execution", async () => {
  const production = createFixture({ env: { NODE_ENV: "production" } })
  const result = await resolveHarvesterOptions(production.input)
  assert.equal(result.brokerName, "binance")
  assert.equal(result.tradingMode, "live")
  assert.equal(result.tradingEnabled, true)


})

test("rejects invalid strategy flags", async () => {
  const aggressive = createFixture({ cfg: config({ aggressive: true }) })
  await assert.rejects(resolveHarvesterOptions(aggressive.input), /Aggressive strategy is disabled and deferred/)
})
