import test from "node:test"
import assert from "node:assert/strict"
import {
  resolveHarvesterRuntimeConfig,
  validateTradingConfig,
} from "./trading-config.js"

const createTradingConfig = () => ({
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
  const config = createTradingConfig()
  assert.equal(validateTradingConfig(config), config, "Strategy and pair settings must remain valid without a runtime profile block.")
  assert.equal(Object.hasOwn(config, "runtime"), false, "Exchange selection must not be stored in trading-config.json.")
  assert.equal(config.strategies.CG_coinGrabber.pairs.ZROFDUSD.investment, 100, "The pair investment setting must remain part of strategy configuration.")
})

test("selects Binance TESTNET from TRADING_MODE even when NODE_ENV says production", () => {
  const runtime = resolveHarvesterRuntimeConfig({ config: createTradingConfig(), tradingMode: "testnet", environment: "production" })
  assert.equal(runtime.brokerName, "binance", "Binance must remain the fixed broker for TESTNET.")
  assert.equal(runtime.tradingMode, "testnet", "TRADING_MODE must select TESTNET independently of NODE_ENV.")
  assert.equal(runtime.tradingEnabled, true, "Trading must be enabled when TESTNET is explicitly selected.")
})

test("selects Binance LIVE from TRADING_MODE even when NODE_ENV says development", () => {
  const runtime = resolveHarvesterRuntimeConfig({ config: createTradingConfig(), tradingMode: "live", environment: "development" })
  assert.equal(runtime.brokerName, "binance", "Binance must remain the fixed broker for LIVE.")
  assert.equal(runtime.tradingMode, "live", "TRADING_MODE must select LIVE independently of NODE_ENV.")
  assert.equal(runtime.tradingEnabled, true, "Selecting LIVE must enable real order execution.")
})

test("fails startup when TRADING_MODE is missing", () => {
  assert.throws(
    () => resolveHarvesterRuntimeConfig({ config: createTradingConfig() }),
    /TRADING_MODE must be set to "testnet" or "live"/,
    "Startup must fail rather than silently choose an exchange mode when TRADING_MODE is absent.",
  )
})

test("rejects every TRADING_MODE value except exact testnet and live", () => {
  for (const tradingMode of ["", "TESTNET", "production", " live", "live "]) {
    assert.throws(
      () => resolveHarvesterRuntimeConfig({ config: createTradingConfig(), tradingMode }),
      /TRADING_MODE must be set to "testnet" or "live"/,
      "An invalid exchange mode must fail startup instead of falling back to another environment: " + JSON.stringify(tradingMode),
    )
  }
})

test("rejects legacy runtime profiles in strategy configuration", () => {
  const config = { ...createTradingConfig(), runtime: { profiles: {} } }
  assert.throws(
    () => validateTradingConfig(config),
    /runtime.*must not be present/,
    "The trading JSON must not retain a second exchange-mode selector.",
  )
})
