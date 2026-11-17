import test from "node:test"
import assert from "node:assert/strict"
import { calculateRecoverySellerSellPlan } from "./calculate-sell-plan.js"

const validInput = {
  recoveryQuantity: "1",
  configuredLegacyQuantity: "0.01",
  legacyRemainingQuantity: "0.01",
  verifiedUnreservedLegacyQuantity: "0.01",
  recoveryCostBasis: "10",
  legacyAverageCost: "20",
  minProfit: "0.01",
  quoteFeeRate: "0",
  baseFeeRate: "0",
  thirdAssetFeeQuoteValue: "0",
  priceTickSize: "0.01",
  quantityStepSize: "0.01",
}

test("targets recovery cost plus legacy historical cost plus minProfit", () => {
  const plan = calculateRecoverySellerSellPlan(validInput)

  assert.equal(plan.requiredNetQuoteProceeds, "10.21")
  assert.equal(plan.grossQuoteProceeds, "10.21")
  assert.equal(plan.quantity, "1.01")
  assert.equal(plan.price, "10.11")
})

test("grosses up quote commission before rounding SELL price upward", () => {
  const plan = calculateRecoverySellerSellPlan({
    ...validInput,
    recoveryQuantity: "1",
    legacyRemainingQuantity: "0",
    verifiedUnreservedLegacyQuantity: "0",
    quoteFeeRate: "0.01",
  })

  assert.equal(plan.requiredNetQuoteProceeds, "10.01")
  assert.equal(plan.grossQuoteProceeds, "10.111111111111111111111111111111111112")
  assert.equal(plan.price, "10.12")
})

test("adds a reliably quote-valued third-asset commission to gross proceeds", () => {
  const plan = calculateRecoverySellerSellPlan({
    ...validInput,
    recoveryQuantity: "1",
    legacyRemainingQuantity: "0",
    verifiedUnreservedLegacyQuantity: "0",
    thirdAssetFeeQuoteValue: "0.05",
  })

  assert.equal(plan.grossQuoteProceeds, "10.06")
  assert.equal(plan.price, "10.06")
})

test("grosses up base-asset commission without dropping the authorized legacy slice", () => {
  const plan = calculateRecoverySellerSellPlan({
    ...validInput,
    baseFeeRate: "0.01",
  })

  assert.equal(plan.quantity, "1")
  assert.equal(plan.baseFeeQuantity, "0.01")
  assert.equal(plan.baseDebitQuantity, "1.01")
  assert.equal(plan.legacyQuantity, "0.01")
  assert.equal(plan.recoverySellQuantity, "0.9900990099009900990099009900990099")
  assert.equal(plan.legacySellQuantity, "0.0099009900990099009900990099009901")
  assert.notEqual(plan.legacySellQuantity, "0",
    "The eligible legacy slice must remain in the mixed SELL after base-fee gross-up.")
})

test("rounds the minimum price upward to the exchange price tick", () => {
  const plan = calculateRecoverySellerSellPlan({
    ...validInput,
    priceTickSize: "0.1",
  })

  assert.equal(plan.requiredNetQuoteProceeds, "10.21")
  assert.equal(plan.price, "10.2")
})

test("fails closed when the quantity step cannot include the full base-fee-adjusted inventory", () => {
  assert.throws(
    () => calculateRecoverySellerSellPlan({
      ...validInput,
      baseFeeRate: "0.02",
      quantityStepSize: "0.1",
    }),
    /cannot include the full recovery and authorized legacy quantities/,
  )
})


test("uses the smaller remaining authorized legacy quantity", () => {
  const plan = calculateRecoverySellerSellPlan({
    ...validInput,
    configuredLegacyQuantity: "0.05",
    legacyRemainingQuantity: "0.01",
    verifiedUnreservedLegacyQuantity: "0.01",
  })

  assert.equal(plan.legacyQuantity, "0.01")
  assert.equal(plan.legacyCostBasis, "0.2")
  assert.equal(plan.requiredNetQuoteProceeds, "10.21")
})

test("does not silently omit authorized legacy inventory when Spot availability is unverified or reserved", () => {
  assert.throws(
    () => calculateRecoverySellerSellPlan({
      ...validInput,
      verifiedUnreservedLegacyQuantity: "0",
    }),
    /Authorized legacy inventory remains/,
  )
})

test("allows recovery-only SELL only after the authorized legacy quantity is exhausted", () => {
  const plan = calculateRecoverySellerSellPlan({
    ...validInput,
    legacyRemainingQuantity: "0",
    verifiedUnreservedLegacyQuantity: "0",
  })

  assert.equal(plan.legacyQuantity, "0")
  assert.equal(plan.quantity, "1")
  assert.equal(plan.requiredNetQuoteProceeds, "10.01")
})

test("rejects invalid fee rates and missing third-asset quote valuation input", () => {
  assert.throws(
    () => calculateRecoverySellerSellPlan({
      ...validInput,
      quoteFeeRate: "1",
    }),
    /quoteFeeRate/,
  )
  assert.throws(
    () => calculateRecoverySellerSellPlan({
      ...validInput,
      thirdAssetFeeQuoteValue: undefined,
    }),
    /thirdAssetFeeQuoteValue/,
  )
})
