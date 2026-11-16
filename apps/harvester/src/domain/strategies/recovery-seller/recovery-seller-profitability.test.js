import test from "node:test"
import assert from "node:assert/strict"
import { calculateRecoverySellerProfitability } from "./recovery-seller-profitability.js"

test("evaluates recovery and legacy profitability independently", () => {
  const result = calculateRecoverySellerProfitability({
    recoveryCostBasis: "10",
    recoveryNetQuoteProceeds: "10.25",
    minProfit: "0.2",
    legacyAverageCost: "2",
    legacyBaseDebit: "0.1",
    legacyNetQuoteProceeds: "0.19",
  })

  assert.equal(result.recovery.netProfit, "0.25")
  assert.equal(result.recovery.eligible, true, "The recovery tranche independently meets minProfit.")
  assert.equal(result.legacy.costBasis, "0.2")
  assert.equal(result.legacy.netProfit, "-0.01")
  assert.equal(result.legacy.eligible, false, "A legacy loss must fail even when recovery is profitable.")
  assert.equal(result.eligible, false, "Recovery profit must never subsidize a loss on the legacy slice.")
})

test("accepts a break-even legacy slice while enforcing the recovery minProfit", () => {
  const result = calculateRecoverySellerProfitability({
    recoveryCostBasis: "10",
    recoveryNetQuoteProceeds: "10.1",
    minProfit: "0.1",
    legacyAverageCost: "2",
    legacyBaseDebit: "0.5",
    legacyNetQuoteProceeds: "1",
  })

  assert.equal(result.recovery.eligible, true)
  assert.equal(result.legacy.netProfit, "0")
  assert.equal(result.legacy.eligible, true, "Legacy proceeds equal to fixed basis and costs satisfy the no-loss gate.")
  assert.equal(result.eligible, true)
})

test("does not apply the legacy gate after authorized legacy inventory is exhausted", () => {
  const result = calculateRecoverySellerProfitability({
    recoveryCostBasis: "10",
    recoveryNetQuoteProceeds: "10.2",
    minProfit: "0.2",
    legacyAverageCost: "2",
    legacyBaseDebit: "0",
    legacyNetQuoteProceeds: "0",
  })

  assert.equal(result.recovery.eligible, true)
  assert.equal(result.legacy.applicable, false)
  assert.equal(result.legacy.eligible, true)
  assert.equal(result.eligible, true, "Recovery-only cycles remain eligible under the recovery minProfit gate.")
})

test("uses actual legacy base debit, including base-denominated SELL commission, for fixed-basis cost", () => {
  const result = calculateRecoverySellerProfitability({
    recoveryCostBasis: "10",
    recoveryNetQuoteProceeds: "10.2",
    minProfit: "0.2",
    legacyAverageCost: "2",
    legacyBaseDebit: "0.0101",
    legacyNetQuoteProceeds: "0.0201",
  })

  assert.equal(result.legacy.costBasis, "0.0202")
  assert.equal(result.legacy.netProfit, "-0.0001")
  assert.equal(result.legacy.eligible, false, "Base commission increases legacy inventory consumed and its historical cost basis.")
})

test("rejects quote proceeds when no legacy base was debited", () => {
  assert.throws(
    () => calculateRecoverySellerProfitability({
      recoveryCostBasis: "10",
      recoveryNetQuoteProceeds: "10.2",
      minProfit: "0.2",
      legacyAverageCost: "2",
      legacyBaseDebit: "0",
      legacyNetQuoteProceeds: "0.01",
    }),
    /legacy.*proceeds|base debit/i,
  )
})

test("rejects invalid or negative profitability inputs", () => {
  assert.throws(
    () => calculateRecoverySellerProfitability({
      recoveryCostBasis: "-1",
      recoveryNetQuoteProceeds: "10",
      minProfit: "0.1",
      legacyAverageCost: "2",
      legacyBaseDebit: "0.1",
      legacyNetQuoteProceeds: "0.2",
    }),
    /non-negative|invalid/i,
  )
})

test("rejects a recovery tranche with no acquired cost basis", () => {
  assert.throws(
    () => calculateRecoverySellerProfitability({
      recoveryCostBasis: "0",
      recoveryNetQuoteProceeds: "1",
      minProfit: "0.1",
      legacyAverageCost: "0",
      legacyBaseDebit: "0",
      legacyNetQuoteProceeds: "0",
    }),
    /recoveryCostBasis.*positive/i,
  )
})
