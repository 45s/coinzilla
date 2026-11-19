import test from "node:test"
import assert from "node:assert/strict"
import { calculateRecoverySellerProfitability } from "./calculate-profitability.js"

const validInput = {
  recoveryCostBasis: "10",
  recoveryNetQuoteProceeds: "10.15",
  minProfit: "0.01",
  legacyAverageCost: "2",
  legacyBaseDebit: "0.1",
  legacyNetQuoteProceeds: "0.19",
}

test("rejects a mixed SELL when recovery profit would subsidize a legacy loss", () => {
  const result = calculateRecoverySellerProfitability(validInput)

  assert.equal(result.recovery.netProfit, "0.15",
    "The recovery allocation must retain its independently calculated net profit.")
  assert.equal(result.recovery.eligible, true,
    "Recovery allocation passes its own minimum-profit requirement.")
  assert.equal(result.legacy.costBasis, "0.2",
    "Legacy cost basis must use the fixed historical average cost.")
  assert.equal(result.legacy.netProfit, "-0.01",
    "Legacy allocation must retain its independently calculated loss.")
  assert.equal(result.legacy.eligible, false,
    "A legacy loss must fail its independent non-loss gate.")
  assert.equal(result.cycle.costBasis, "10.2",
    "Combined cycle cost must include recovery and legacy cost bases.")
  assert.equal(result.cycle.netQuoteProceeds, "10.34",
    "Combined cycle proceeds must include both independently allocated proceeds.")
  assert.equal(result.cycle.netProfit, "0.14",
    "The combined cycle result must remain visible even when one allocation fails.")
  assert.equal(result.cycle.minProfit, "0.01",
    "The combined cycle must retain the configured minimum-profit requirement.")
  assert.equal(result.cycle.eligible, true,
    "The combined cycle may pass while the legacy allocation independently fails.")
  assert.equal(result.eligible, false,
    "Overall SELL eligibility must require every applicable profitability gate.")
})

test("rejects a mixed SELL when legacy profit would subsidize a recovery loss", () => {
  const result = calculateRecoverySellerProfitability({
    ...validInput,
    recoveryNetQuoteProceeds: "9.995",
    legacyNetQuoteProceeds: "0.3",
  })

  assert.equal(result.recovery.netProfit, "-0.005",
    "Recovery allocation must expose its loss without netting legacy profit against it.")
  assert.equal(result.recovery.eligible, false,
    "A recovery loss must fail its independent minimum-profit requirement.")
  assert.equal(result.legacy.netProfit, "0.1",
    "Legacy allocation must retain its independent profit.")
  assert.equal(result.legacy.eligible, true,
    "A profitable legacy allocation passes its non-loss requirement.")
  assert.equal(result.cycle.netProfit, "0.095",
    "Combined cycle profit must remain independently calculated.")
  assert.equal(result.cycle.eligible, true,
    "The combined cycle can pass even though the recovery allocation fails.")
  assert.equal(result.eligible, false,
    "Overall SELL eligibility must reject a recovery loss despite profitable legacy proceeds.")
})

test("accepts a mixed SELL only when recovery, legacy and combined gates all pass", () => {
  const result = calculateRecoverySellerProfitability({
    ...validInput,
    legacyNetQuoteProceeds: "0.21",
  })

  assert.equal(result.recovery.eligible, true,
    "Recovery profit must meet the configured minimum-profit requirement.")
  assert.equal(result.legacy.netProfit, "0.01",
    "Legacy profit must be calculated against its historical cost basis.")
  assert.equal(result.legacy.eligible, true,
    "Legacy allocation must be non-loss-making.")
  assert.equal(result.cycle.eligible, true,
    "Combined cycle profit must meet pair-level minProfit.")
  assert.equal(result.eligible, true,
    "Overall eligibility passes only after every applicable gate passes.")
})

test("accepts a break-even legacy allocation when recovery and combined gates pass", () => {
  const result = calculateRecoverySellerProfitability({
    ...validInput,
    legacyNetQuoteProceeds: "0.2",
  })

  assert.equal(result.legacy.netProfit, "0",
    "Legacy proceeds equal to historical cost must be represented as break-even.")
  assert.equal(result.legacy.eligible, true,
    "The legacy non-loss gate accepts exact break-even proceeds.")
  assert.equal(result.eligible, true,
    "A break-even legacy slice is allowed when recovery and combined gates pass.")
})

test("combined cycle gate rejects proceeds below minProfit", () => {
  const result = calculateRecoverySellerProfitability({
    ...validInput,
    recoveryNetQuoteProceeds: "10.019",
    legacyNetQuoteProceeds: "0.19",
  })

  assert.equal(result.recovery.netProfit, "0.019",
    "Recovery allocation profit must remain separate from combined cycle profit.")
  assert.equal(result.recovery.eligible, true,
    "Recovery allocation meets its minimum-profit threshold.")
  assert.equal(result.legacy.eligible, false,
    "Legacy loss must independently fail.")
  assert.equal(result.cycle.netProfit, "0.009",
    "Combined cycle net profit must be calculated without rounding away the shortfall.")
  assert.equal(result.cycle.eligible, false,
    "The combined cycle must fail when net profit is below minProfit.")
  assert.equal(result.eligible, false,
    "Overall eligibility must remain false when the combined gate fails.")
})

test("recovery-only cycles require recovery and combined gates without a legacy gate", () => {
  const profitable = calculateRecoverySellerProfitability({
    ...validInput,
    recoveryNetQuoteProceeds: "10.01",
    legacyBaseDebit: "0",
    legacyNetQuoteProceeds: "0",
  })
  const unprofitable = calculateRecoverySellerProfitability({
    ...validInput,
    recoveryNetQuoteProceeds: "10.009",
    legacyBaseDebit: "0",
    legacyNetQuoteProceeds: "0",
  })

  assert.equal(profitable.legacy.applicable, false,
    "An exhausted legacy allocation must not be treated as an active zero-cost Position.")
  assert.equal(profitable.legacy.eligible, true,
    "An inapplicable legacy allocation must not block recovery-only operation.")
  assert.equal(profitable.eligible, true,
    "Recovery-only operation passes when recovery and combined minimum-profit gates pass.")
  assert.equal(unprofitable.recovery.eligible, false,
    "Recovery-only operation must fail when recovery profit is below minProfit.")
  assert.equal(unprofitable.cycle.eligible, false,
    "The combined recovery-only cycle must also fail below minProfit.")
  assert.equal(unprofitable.eligible, false,
    "Recovery-only operation must not bypass either applicable profitability gate.")
})

test("rejects legacy proceeds when no legacy base quantity was debited", () => {
  assert.throws(
    () => calculateRecoverySellerProfitability({
      ...validInput,
      legacyBaseDebit: "0",
      legacyNetQuoteProceeds: "0.01",
    }),
    /Legacy quote proceeds require a positive legacy base debit/,
    "Legacy proceeds without a corresponding legacy base debit are invalid.",
  )
})

test("rejects missing legacy cost basis when legacy inventory is debited", () => {
  assert.throws(
    () => calculateRecoverySellerProfitability({
      ...validInput,
      legacyAverageCost: "0",
    }),
    /legacyAverageCost must be positive when legacy base is debited/,
    "Legacy liquidation must fail closed when historical cost basis is missing.",
  )
})

test("rejects negative proceeds and invalid recovery cost inputs", () => {
  assert.throws(
    () => calculateRecoverySellerProfitability({
      ...validInput,
      legacyNetQuoteProceeds: "-0.01",
    }),
    /non-negative/,
    "Negative allocated proceeds must not be accepted as a valid profitability input.",
  )
  assert.throws(
    () => calculateRecoverySellerProfitability({
      ...validInput,
      recoveryCostBasis: "0",
    }),
    /recoveryCostBasis must be positive/,
    "Recovery profitability requires a positive authoritative BUY cost basis.",
  )
})
