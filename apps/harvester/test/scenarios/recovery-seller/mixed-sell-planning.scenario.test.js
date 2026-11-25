import test from "node:test"
import assert from "node:assert/strict"
import { divideDecimal } from "@coinzilla/utils"
import { calculateRecoverySellerSellPlan } from "../../../src/domain/strategies/recovery-seller/calculate-sell-plan.js"

function createPlan({
  legacyRemainingQuantity = "0.01",
  verifiedUnreservedLegacyQuantity = "0.01",
  quantityStepSize = "0.01",
} = {}) {
  const legacyInvested = "0.20"
  const originalLegacyQuantity = "0.01"
  const legacyAverageCost = divideDecimal({
    left: legacyInvested,
    right: originalLegacyQuantity,
  })
  return calculateRecoverySellerSellPlan({
    recoveryQuantity: "1",
    configuredLegacyQuantity: "0.01",
    legacyRemainingQuantity,
    verifiedUnreservedLegacyQuantity,
    recoveryCostBasis: "10",
    legacyAverageCost,
    minProfit: "0.01",
    quoteFeeRate: "0",
    baseFeeRate: "0",
    thirdAssetFeeQuoteValue: "0",
    priceTickSize: "0.01",
    quantityStepSize,
  })
}

test("RS-003-001: the mixed SELL adds the authorized legacy slice to canonical recovery inventory", () => {
  const plan = createPlan()

  assert.equal(plan.recoveryQuantity, "1",
    "The recovery allocation must remain the exact quantity established by canonical BUY fills.")
  assert.equal(plan.legacyQuantity, "0.01",
    "The SELL may add only the configured legacy slice that remains authorized and verified in Spot.")
  assert.equal(plan.quantity, "1.01",
    "The total SELL quantity must equal one recovery unit plus the additive 0.01 legacy slice.")
  assert.equal(plan.recoverySellQuantity, "1",
    "The allocation oracle must assign exactly one unit of the mixed SELL to recovery inventory.")
  assert.equal(plan.legacySellQuantity, "0.01",
    "The allocation oracle must assign exactly 0.01 unit of the mixed SELL to legacy inventory.")
  assert.equal(plan.recoveryRequiredNetQuoteProceeds, "10.1101",
    "The recovery allocation must independently recover its 10 quote cost plus minimum profit at the mixed quantity ratio.")
  assert.equal(plan.legacyRequiredNetQuoteProceeds, "20.2",
    "The legacy allocation must independently recover its 0.20 historical basis at the mixed quantity ratio.")
  assert.equal(plan.combinedRequiredNetQuoteProceeds, "10.21",
    "The combined allocation must independently recover both cost bases plus minimum profit.")
  assert.equal(plan.requiredNetQuoteProceeds, "20.2",
    "The required proceeds must be the maximum of all three independent profitability targets.")
  assert.equal(plan.price, "20",
    "The minimum SELL price must be rounded upward to the exact 0.01 quote-asset tick.")
})

test("RS-003-002: the mixed SELL uses only the smaller authorized legacy remainder", () => {
  const plan = createPlan({
    legacyRemainingQuantity: "0.005",
    verifiedUnreservedLegacyQuantity: "0.005",
    quantityStepSize: "0.001",
  })

  assert.equal(plan.legacyQuantity, "0.005",
    "The legacy slice must be capped at the smaller remaining authorized Spot quantity.")
  assert.equal(plan.quantity, "1.005",
    "The total SELL quantity must not reuse the unconsumed configured legacy amount.")
  assert.equal(plan.recoverySellQuantity, "1",
    "The recovery allocation must retain its canonical one-unit inventory.")
  assert.equal(plan.legacySellQuantity, "0.005",
    "The smaller verified legacy remainder must be allocated without being rounded upward.")
})

test("RS-003-003: exhausted legacy inventory produces a recovery-only SELL plan", () => {
  const plan = createPlan({
    legacyRemainingQuantity: "0",
    verifiedUnreservedLegacyQuantity: "0",
  })

  assert.equal(plan.legacyQuantity, "0",
    "An exhausted legacy allocation must contribute no quantity to a later recovery cycle.")
  assert.equal(plan.quantity, "1",
    "A recovery-only SELL must contain only the canonical recovery quantity.")
  assert.equal(plan.recoverySellQuantity, "1",
    "All planned SELL quantity must be assigned to the recovery allocation.")
  assert.equal(plan.legacySellQuantity, "0",
    "No legacy quantity may be fabricated or reused after the authorized remainder is exhausted.")
})
