import assert from "node:assert/strict"
import test from "node:test"
import { appConfig } from "../../config/index.js"
import { validateAppConfig } from "./app-config.js"

test("keeps Recovery Seller explicitly disabled in the default application configuration", () => {
  assert.equal(
    appConfig.strategies.RS_recoverySeller?.enabled,
    false,
    "RS must be present as an independent strategy and disabled until an operator supplies valid legacy authorization.",
  )
  assert.equal(
    validateAppConfig(appConfig),
    appConfig,
    "The default application configuration must validate without enabling or authorizing RS.",
  )
})


function createEnabledRecoverySellerConfig() {
  const config = structuredClone(appConfig)
  config.strategies.RS_recoverySeller = {
    enabled: true,
    pairs: {
      ZROUSDT: {
        enabled: true,
        tradingEnvironment: "testnet",
        enableVolatilityProtection: true,
        investment: 100,
        orderQuantity: 5,
        sellQuantity: 0.01,
        minProfit: 0.01,
        priceStepPercent: 0.05,
        makerPercent: 0,
        takerPercent: 0.1,
        legacyPosition: {
          invested: 100,
          quantity: 50,
        },
      },
    },
  }
  return config
}

test("validates explicit RS legacy authorization and per-market trading configuration", () => {
  const config = createEnabledRecoverySellerConfig()
  assert.equal(validateAppConfig(config), config)
})

test("rejects enabled RS without a configured market and explicit legacy basis", () => {
  const noPairs = createEnabledRecoverySellerConfig()
  noPairs.strategies.RS_recoverySeller.pairs = {}
  assert.throws(
    () => validateAppConfig(noPairs),
    /RS_recoverySeller.*pairs|Recovery Seller.*pair/i,
    "Enabled RS must not start without an explicitly configured market.",
  )

  const noLegacyBasis = createEnabledRecoverySellerConfig()
  delete noLegacyBasis.strategies.RS_recoverySeller.pairs.ZROUSDT.legacyPosition
  assert.throws(
    () => validateAppConfig(noLegacyBasis),
    /legacyPosition/i,
    "RS must not infer legacy ownership or historical cost from wallet balances.",
  )
})

test("rejects RS legacy SELL authorization larger than the declared original quantity", () => {
  const config = createEnabledRecoverySellerConfig()
  config.strategies.RS_recoverySeller.pairs.ZROUSDT.sellQuantity = 51
  assert.throws(
    () => validateAppConfig(config),
    /sellQuantity.*legacyPosition.quantity|legacyPosition.quantity.*sellQuantity/i,
  )
})
