import test from "node:test"
import assert from "node:assert/strict"
import { createMarketVolatilityProtectionEligibility } from "./create-market-volatility-protection-eligibility.js"

const markets = {
  DOGEUSDT: {
    enabled: true,
    enableVolatilityProtection: true,
  },
  LINEAUSDT: {
    enabled: true,
    enableVolatilityProtection: true,
  },
  DISABLEDUSDT: {
    enabled: false,
    enableVolatilityProtection: true,
  },
  OPTEDOUTUSDT: {
    enabled: true,
    enableVolatilityProtection: false,
  },
}

test("volatility eligibility depends only on effective market configuration", () => {
  const isEligible = createMarketVolatilityProtectionEligibility({
    markets,
    volatilityProtectionEnabled: true,
  })

  assert.equal(isEligible("DOGEUSDT"), true, "A configured market with protection enabled must be eligible.")
  assert.equal(isEligible("LINEAUSDT"), true, "An RS-only market with protection enabled must be eligible without CG ownership.")
  assert.equal(isEligible("DISABLEDUSDT"), false, "Disabled markets must not receive volatility protection.")
  assert.equal(isEligible("OPTEDOUTUSDT"), false, "Markets explicitly opting out must not receive volatility protection.")
  assert.equal(isEligible("UNKNOWNUSDT"), false, "Markets absent from the effective market map must fail closed.")
})

test("volatility eligibility fails closed when candle-history data is unavailable", () => {
  const isEligible = createMarketVolatilityProtectionEligibility({
    markets,
    volatilityProtectionEnabled: false,
  })

  assert.equal(isEligible("LINEAUSDT"), false)
})
