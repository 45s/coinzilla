import assert from "node:assert/strict"
import test from "node:test"
import { recoverySellerPairs } from "../../rs-recovery-seller.js"
import { loadAppConfig } from "../../src/infrastructure/config/load-app-config.js"
import { TRADING_ENVIRONMENTS } from "../../src/domain/trading-environment.js"
import { RS_RECOVERY_SELLER_CONFIG } from "./rs-recovery-seller.js"

test("keeps Recovery Seller disabled until explicit execution routing is implemented", () => {
  assert.equal(
    RS_RECOVERY_SELLER_CONFIG.enabled,
    false,
    "RS remains disabled until the default runtime has explicit TESTNET execution routing.",
  )
})

test("declares the approved LINEAUSDT Recovery Seller configuration and resolves TESTNET precision", async () => {
  assert.deepEqual(
    recoverySellerPairs.LINEAUSDT,
    {
      enabled: true,
      tradingEnvironment: TRADING_ENVIRONMENTS.TESTNET,
      enableVolatilityProtection: false,
      legacyPosition: {
        invested: 400,
        quantity: 25000,
      },
      sellQuantity: 10,
      investment: 100,
      orderQuantity: 7000,
      minProfit: 0.01,
      priceStepPercent: 0.5,
      makerPercent: 0.1,
      takerPercent: 0.1,
    },
    "LINEAUSDT must match the operator-approved Recovery Seller settings exactly.",
  )
  assert.equal(
    RS_RECOVERY_SELLER_CONFIG.enabled,
    false,
    "Adding an authorized market must not enable the global Recovery Seller runtime switch.",
  )

  const config = await loadAppConfig()
  const pair = config.strategies.RS_recoverySeller.pairs.LINEAUSDT
  assert.equal(pair.pricePrecision, 6, "LINEAUSDT price precision must resolve from its TESTNET tick size.")
  assert.equal(pair.quantityPrecision, 0, "LINEAUSDT quantity precision must resolve from its TESTNET step size.")
})
