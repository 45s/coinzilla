import test from "node:test"
import assert from "node:assert/strict"
import { calculateRecoverySellerProfitability } from "../../src/domain/strategies/recovery-seller/calculate-profitability.js"

const recovery = {
  recoveryCostBasis: "10",
  recoveryNetQuoteProceeds: "10.0101",
  minProfit: "0.01",
}

test("RS-004-INPUT-BOUNDARY-005: legacy allocation accepts exact break-even", () => {
  const result = calculateRecoverySellerProfitability({
    ...recovery,
    legacyAverageCost: "2",
    legacyBaseDebit: "0.1",
    legacyNetQuoteProceeds: "0.2",
  })

  assert.equal(result.legacy.costBasis, "0.2",
    "Legacy basis must be independently derived from average cost multiplied by the allocated base.")
  assert.equal(result.legacy.netProfit, "0",
    "Legacy break-even must remain exactly zero rather than be rounded into a gain or loss.")
  assert.equal(result.legacy.eligible, true,
    "The legacy gate must accept exact break-even.")
  assert.equal(result.eligible, true,
    "All three gates must pass when legacy is exactly break-even and recovery/combined meet minProfit.")
})

test("RS-004-INPUT-BOUNDARY-006: legacy gate rejects a decimal loss below break-even", () => {
  const result = calculateRecoverySellerProfitability({
    ...recovery,
    legacyAverageCost: "2",
    legacyBaseDebit: "0.1",
    legacyNetQuoteProceeds: "0.1999",
  })

  assert.equal(result.legacy.netProfit, "-0.0001",
    "The legacy oracle must preserve the exact one-ten-thousandth loss.")
  assert.equal(result.legacy.eligible, false,
    "The legacy gate must reject any exact-decimal loss, however small.")
  assert.equal(result.cycle.eligible, true,
    "Combined profitability must remain independently reported and must not hide the legacy loss.")
  assert.equal(result.eligible, false,
    "Overall eligibility must reject the failed legacy gate despite recovery and combined profitability.")
})

test("RS-004-INPUT-BOUNDARY-007: an exhausted legacy allocation is inapplicable and has no quote proceeds", () => {
  const result = calculateRecoverySellerProfitability({
    ...recovery,
    legacyAverageCost: "0",
    legacyBaseDebit: "0",
    legacyNetQuoteProceeds: "0",
  })

  assert.equal(result.legacy.applicable, false,
    "Zero legacy base debit must mark the legacy allocation as exhausted.")
  assert.equal(result.legacy.costBasis, "0",
    "An exhausted legacy allocation must not retain a phantom cost basis.")
  assert.equal(result.legacy.eligible, true,
    "An exhausted legacy allocation must not add an independent profitability gate.")
  assert.equal(result.eligible, true,
    "Recovery-only operation must pass when its remaining applicable gates meet minProfit.")
})

test("RS-004-INPUT-BOUNDARY-008: legacy proceeds without a legacy base debit are rejected", () => {
  assert.throws(() => calculateRecoverySellerProfitability({
    ...recovery,
    legacyAverageCost: "0",
    legacyBaseDebit: "0",
    legacyNetQuoteProceeds: "0.001",
  }), /Legacy quote proceeds require a positive legacy base debit/,
  "Proceeds attributed to an exhausted legacy allocation must be rejected.")
})

test("RS-004-INPUT-BOUNDARY-009: non-positive recovery cost basis is rejected", () => {
  assert.throws(() => calculateRecoverySellerProfitability({
    ...recovery,
    recoveryCostBasis: "0",
    legacyAverageCost: "0",
    legacyBaseDebit: "0",
    legacyNetQuoteProceeds: "0",
  }), /recoveryCostBasis must be positive/,
  "Recovery profitability must not be calculated against a zero or negative recovery basis.")
})

test("RS-004-INPUT-BOUNDARY-010: non-positive minProfit is rejected", () => {
  assert.throws(() => calculateRecoverySellerProfitability({
    ...recovery,
    minProfit: "0",
    legacyAverageCost: "0",
    legacyBaseDebit: "0",
    legacyNetQuoteProceeds: "0",
  }), /minProfit must be greater than zero/,
  "The recovery profitability gate must reject a zero minimum-profit configuration.")
})
