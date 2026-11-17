import test from "node:test"
import assert from "node:assert/strict"
import { calculateRecoverySellerProfitability } from "./calculate-profitability.js"

const validInput = {
  recoveryCostBasis: "10",
  recoveryNetQuoteProceeds: "10.15",
  minProfit: "0.01",
  legacyAverageCost: "2",
  legacyBaseDebit: "0.1",
  legacyNetQuoteProceeds: "0.21",
}

test("requires both independent profitability gates when a legacy slice is included", () => {
  const result = calculateRecoverySellerProfitability({
    ...validInput,
    legacyNetQuoteProceeds: "0.19",
  })

  assert.equal(result.recovery.netProfit, "0.15")
  assert.equal(result.recovery.eligible, true,
    "Recovery must independently recover its full BUY cost plus minProfit.")
  assert.equal(result.legacy.costBasis, "0.2")
  assert.equal(result.legacy.netProfit, "-0.01")
  assert.equal(result.legacy.eligible, false,
    "Recovery profit must not subsidize a legacy historical-basis loss.")
  assert.equal(result.cycle.netProfit, "0.14",
    "The combined cycle net profit remains diagnostic only.")
  assert.equal(result.cycle.eligible, false,
    "Overall eligibility must require both applicable independent gates.")
  assert.equal(result.eligible, false,
    "A legacy loss must block the mixed SELL even when recovery profitability passes.")
})

test("rejects a recovery loss even when the legacy slice earns enough to offset it", () => {
  const result = calculateRecoverySellerProfitability({
    ...validInput,
    recoveryNetQuoteProceeds: "10.009",
    legacyNetQuoteProceeds: "0.3",
  })

  assert.equal(result.recovery.netProfit, "0.009")
  assert.equal(result.recovery.eligible, false,
    "Recovery must independently meet minProfit.")
  assert.equal(result.legacy.netProfit, "0.1")
  assert.equal(result.legacy.eligible, true,
    "Legacy historical basis may independently break even or profit.")
  assert.equal(result.cycle.netProfit, "0.109")
  assert.equal(result.cycle.eligible, false,
    "Legacy surplus must not subsidize a recovery tranche that misses minProfit.")
  assert.equal(result.eligible, false)
})

test("accepts a mixed SELL only when both recovery and legacy gates pass", () => {
  const result = calculateRecoverySellerProfitability(validInput)

  assert.equal(result.recovery.eligible, true)
  assert.equal(result.legacy.eligible, true)
  assert.equal(result.cycle.netProfit, "0.16")
  assert.equal(result.cycle.eligible, true)
  assert.equal(result.eligible, true)
})

test("recovery-only cycles require the recovery minProfit gate and no legacy gate", () => {
  const eligible = calculateRecoverySellerProfitability({
    ...validInput,
    recoveryNetQuoteProceeds: "10.01",
    legacyBaseDebit: "0",
    legacyNetQuoteProceeds: "0",
  })
  const ineligible = calculateRecoverySellerProfitability({
    ...validInput,
    recoveryNetQuoteProceeds: "10.009",
    legacyBaseDebit: "0",
    legacyNetQuoteProceeds: "0",
  })

  assert.equal(eligible.legacy.applicable, false)
  assert.equal(eligible.legacy.eligible, true)
  assert.equal(eligible.recovery.eligible, true)
  assert.equal(eligible.eligible, true)
  assert.equal(ineligible.recovery.eligible, false)
  assert.equal(ineligible.legacy.eligible, true)
  assert.equal(ineligible.eligible, false)
})

test("rejects legacy proceeds when no legacy base quantity was debited", () => {
  assert.throws(
    () => calculateRecoverySellerProfitability({
      ...validInput,
      legacyBaseDebit: "0",
      legacyNetQuoteProceeds: "0.01",
    }),
    /Legacy quote proceeds require a positive legacy base debit/,
  )
})

test("rejects negative proceeds and invalid cost inputs", () => {
  assert.throws(
    () => calculateRecoverySellerProfitability({
      ...validInput,
      legacyNetQuoteProceeds: "-0.01",
    }),
    /non-negative/,
  )
  assert.throws(
    () => calculateRecoverySellerProfitability({
      ...validInput,
      recoveryCostBasis: "0",
    }),
    /recoveryCostBasis must be positive/,
  )
})
