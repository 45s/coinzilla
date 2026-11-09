import test from "node:test"
import assert from "node:assert/strict"
import {
  resolveHarvesterRuntimeConfig,
  validateTradingConfig,
} from "./trading-config.js"

const createTradingConfig = (runtime = {}) => ({
  runtime,
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: {
        minProfit: 0.01,
        conservative: { enabled: true },
        aggressive: { enabled: false },
      },
      pairs: {
        ZROUSDT: {
          enabled: true,
          investment: 100,
          orderQuantity: 5,
          keepQuantity: 0.01,
          priceStepPercent: 0.05,
          pricePrecision: 3,
          quantityPrecision: 1,
          makerPercent: 0.1,
          takerPercent: 0.1,
        },
      },
    },
  },
})

const runtimeProfiles = {
  profiles: {
    default: {
      broker: null,
      trading: { enabled: false, mode: "testnet" },
    },
    development: {
      broker: "binance",
      trading: { enabled: true, mode: "testnet" },
    },
    test: {
      broker: "binance",
      trading: { enabled: false, mode: "testnet" },
    },
    production: {
      broker: "binance",
      trading: { enabled: true, mode: "live" },
    },
  },
}

test("selects the explicit development profile for Binance TESTNET trading", () => {
  const config = validateTradingConfig(createTradingConfig(runtimeProfiles))
  const runtime = resolveHarvesterRuntimeConfig({ config, environment: "development" })

  assert.equal(runtime.brokerName, "binance", "Development must connect to the configured Binance broker.")
  assert.equal(runtime.tradingMode, "testnet", "Development trading must use Binance TESTNET.")
  assert.equal(runtime.tradingRequested, true, "Development profile must preserve its explicit TESTNET trading opt-in.")
  assert.equal(runtime.tradingEnabled, true, "Development profile must enable Conservative execution only on TESTNET.")
})

test("selects the production profile for Binance LIVE order execution", () => {
  const config = validateTradingConfig(createTradingConfig(runtimeProfiles))
  const runtime = resolveHarvesterRuntimeConfig({ config, environment: "production" })

  assert.equal(runtime.brokerName, "binance", "Production must connect to Binance LIVE market and account endpoints.")
  assert.equal(runtime.tradingMode, "live", "Production profile must select LIVE exchange connectivity.")
  assert.equal(runtime.tradingRequested, true, "Production profile must explicitly opt into LIVE order execution.")
  assert.equal(runtime.tradingEnabled, true, "Production profile must enable LIVE execution.")
})

test("uses a safe read-only profile for tests and unspecified environments", () => {
  const config = validateTradingConfig(createTradingConfig(runtimeProfiles))
  const testRuntime = resolveHarvesterRuntimeConfig({ config, environment: "test" })
  const defaultRuntime = resolveHarvesterRuntimeConfig({ config })

  assert.equal(testRuntime.brokerName, "binance", "The test profile must allow broker fakes without enabling trading.")
  assert.equal(testRuntime.tradingEnabled, false, "Tests must never inherit development order execution by default.")
  assert.equal(defaultRuntime.brokerName, undefined, "An unspecified environment must not silently connect to an exchange.")
  assert.equal(defaultRuntime.tradingEnabled, false, "An unspecified environment must remain read-only.")
})

test("rejects unsupported broker names in every declared runtime profile", () => {
  const config = createTradingConfig({
    profiles: {
      default: { broker: null, trading: { enabled: false, mode: "testnet" } },
      production: { broker: "unknown", trading: { enabled: false, mode: "live" } },
    },
  })

  assert.throws(
    () => validateTradingConfig(config),
    /runtime\.profiles\.production\.broker/,
    "A runtime profile must not silently select an unsupported broker implementation.",
  )
})

test("rejects LIVE execution in the development profile", () => {
  const config = createTradingConfig({
    profiles: {
      default: { broker: null, trading: { enabled: false, mode: "testnet" } },
      development: { broker: "binance", trading: { enabled: true, mode: "live" } },
    },
  })

  assert.throws(
    () => validateTradingConfig(config),
    /live" for development execution/,
    "Selecting LIVE exchange connectivity must not enable real-money order execution.",
  )
})

test("rejects production execution when profile selects TESTNET", () => {
  const config = createTradingConfig({
    profiles: {
      default: { broker: null, trading: { enabled: false, mode: "testnet" } },
      production: { broker: "binance", trading: { enabled: true, mode: "testnet" } },
    },
  })

  assert.throws(
    () => validateTradingConfig(config),
    /live" for production execution/,
    "Production must remain read-only even if a profile accidentally requests TESTNET trading.",
  )
})
