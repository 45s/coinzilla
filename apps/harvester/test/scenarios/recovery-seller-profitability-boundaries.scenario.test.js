import test from "node:test"
import assert from "node:assert/strict"
import { calculateRecoverySellerProfitability } from "../../src/domain/strategies/recovery-seller/calculate-profitability.js"

const baseInput = {
  recoveryCostBasis: "10",
  minProfit: "0.01",
  legacyAverageCost: "2",
  legacyBaseDebit: "0",
  legacyNetQuoteProceeds: "0",
}

test("RS-004-SCENARIO-BOUNDARY-001: recovery profit equal to one-cent minProfit is eligible", () => {
  const result = calculateRecoverySellerProfitability({
    ...baseInput,
    recoveryNetQuoteProceeds: "10.01",
  })

  assert.equal(result.recovery.netProfit, "0.01",
    "The recovery allocation must calculate exactly one cent of net profit.")
  assert.equal(result.recovery.eligible, true,
    "The recovery gate must accept equality with the configured absolute one-cent threshold.")
  assert.equal(result.cycle.netProfit, "0.01",
    "The recovery-only combined cycle must retain exactly one cent of net profit.")
  assert.equal(result.cycle.eligible, true,
    "The combined gate must accept equality at the configured minimum.")
  assert.equal(result.legacy.applicable, false,
    "An empty legacy allocation must not introduce an independent profitability gate.")
  assert.equal(result.eligible, true,
    "The recovery-only SELL must pass when both applicable gates meet exact equality.")
})

test("RS-004-SCENARIO-BOUNDARY-002: recovery profit one thousandth below minProfit is ineligible", () => {
  const result = calculateRecoverySellerProfitability({
    ...baseInput,
    recoveryNetQuoteProceeds: "10.009",
  })

  assert.equal(result.recovery.netProfit, "0.009",
    "Exact decimal arithmetic must preserve the one-thousandth shortfall.")
  assert.equal(result.recovery.eligible, false,
    "The recovery gate must reject profit below the absolute one-cent minimum.")
  assert.equal(result.cycle.netProfit, "0.009",
    "The recovery-only cycle must expose the exact shortfall rather than round it away.")
  assert.equal(result.cycle.eligible, false,
    "The combined gate must reject profit below the absolute one-cent minimum.")
  assert.equal(result.eligible, false,
    "Overall eligibility must fail when an applicable gate is below its threshold.")
})

test("RS-004-SCENARIO-BOUNDARY-003: recovery gate accepts profit above minProfit", () => {
  const result = calculateRecoverySellerProfitability({
    ...baseInput,
    recoveryNetQuoteProceeds: "10.011",
  })

  assert.equal(result.recovery.netProfit, "0.011",
    "The recovery oracle must retain the exact profit above threshold.")
  assert.equal(result.recovery.eligible, true,
    "The recovery allocation must accept a profit above the absolute one-cent minimum.")
  assert.equal(result.cycle.eligible, true,
    "The combined recovery-only cycle must accept the same profit.")
  assert.equal(result.eligible, true,
    "Overall eligibility must pass when both applicable gates exceed the threshold.")
})

test("RS-004-SCENARIO-BOUNDARY-004: profitable recovery cannot subsidize legacy loss", () => {
  const result = calculateRecoverySellerProfitability({
    recoveryCostBasis: "10",
    recoveryNetQuoteProceeds: "10.15",
    minProfit: "0.01",
    legacyAverageCost: "2",
    legacyBaseDebit: "0.1",
    legacyNetQuoteProceeds: "0.19",
  })

  assert.equal(result.recovery.netProfit, "0.15",
    "Recovery profit must be calculated from its own cost basis and proceeds.")
  assert.equal(result.recovery.eligible, true,
    "Recovery must pass its own gate without using legacy proceeds.")
  assert.equal(result.legacy.costBasis, "0.2",
    "Legacy cost basis must derive from the fixed average cost and allocated base debit.")
  assert.equal(result.legacy.netProfit, "-0.01",
    "The legacy slice must expose its own one-cent loss.")
  assert.equal(result.legacy.eligible, false,
    "The legacy gate must reject its loss regardless of recovery profit.")
  assert.equal(result.cycle.eligible, true,
    "The combined-cycle gate result must remain independently visible.")
  assert.equal(result.eligible, false,
    "Overall SELL eligibility must reject cross-subsidy even when the combined gate passes.")
})
