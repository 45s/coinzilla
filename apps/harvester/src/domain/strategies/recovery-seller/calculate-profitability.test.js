import test from "node:test"
import assert from "node:assert/strict"
import { calculateRecoverySellerProfitability } from "./calculate-profitability.js"

const validProfitabilityInput = {
  recoveryCostBasis: "10",
  recoveryNetQuoteProceeds: "10.25",
  minProfit: "0.2",
  legacyAverageCost: "2",
  legacyBaseDebit: "0.1",
  legacyNetQuoteProceeds: "0.19",
}

function calculateProfitability(overrides = {}) {
  return calculateRecoverySellerProfitability({
    ...validProfitabilityInput,
    ...overrides,
  })
}

test("rejects a legacy loss even when the recovery tranche independently meets minProfit", () => {
  const result = calculateProfitability()

  assert.equal(result.recovery.netProfit, "0.25", "The recovery allocation must retain its independently calculated net profit.")
  assert.equal(result.recovery.eligible, true, "The recovery allocation must pass when its net profit meets minProfit.")
  assert.equal(result.legacy.costBasis, "0.2", "The legacy cost basis must use the fixed average cost multiplied by the actual legacy base debit.")
  assert.equal(result.legacy.netProfit, "-0.01", "The legacy allocation must expose its own loss without offsetting it against recovery profit.")
  assert.equal(result.legacy.eligible, false, "A loss on the legacy allocation must fail its independent profitability gate.")
  assert.equal(result.eligible, false, "Overall eligibility must fail whenever either applicable profitability gate fails.")
})

test("accepts a break-even legacy allocation when the recovery tranche meets minProfit", () => {
  const result = calculateProfitability({
    recoveryNetQuoteProceeds: "10.1",
    minProfit: "0.1",
    legacyBaseDebit: "0.5",
    legacyNetQuoteProceeds: "1",
  })

  assert.equal(result.recovery.eligible, true, "The recovery allocation must pass at exact minProfit equality.")
  assert.equal(result.legacy.netProfit, "0", "The legacy allocation must report exact break-even after its historical cost basis.")
  assert.equal(result.legacy.eligible, true, "A legacy allocation that fully recovers its own basis and costs must pass the no-loss gate.")
  assert.equal(result.eligible, true, "Both independently applicable gates must pass for the combined SELL to be eligible.")
})

test("continues recovery-only eligibility after the authorized legacy inventory is exhausted", () => {
  const result = calculateProfitability({
    recoveryNetQuoteProceeds: "10.2",
    minProfit: "0.2",
    legacyBaseDebit: "0",
    legacyNetQuoteProceeds: "0",
  })

  assert.equal(result.recovery.eligible, true, "Recovery-only cycles must continue to use the existing pair-level minProfit.")
  assert.equal(result.legacy.applicable, false, "The legacy gate must be inapplicable when no legacy base quantity is debited.")
  assert.equal(result.legacy.eligible, true, "An exhausted legacy position must not block an otherwise profitable recovery-only cycle.")
  assert.equal(result.eligible, true, "Recovery-only eligibility must depend on the recovery gate after legacy exhaustion.")
})

test("includes the legacy-allocated base SELL commission in the historical cost basis", () => {
  const legacyBaseDebitIncludingAllocatedCommission = "0.0101"
  const result = calculateProfitability({
    recoveryNetQuoteProceeds: "10.2",
    minProfit: "0.2",
    legacyBaseDebit: legacyBaseDebitIncludingAllocatedCommission,
    legacyNetQuoteProceeds: "0.0201",
  })

  assert.equal(result.legacy.costBasis, "0.0202", "Legacy historical cost must include the base units consumed by the SELL commission.")
  assert.equal(result.legacy.netProfit, "-0.0001", "The legacy net result must use the full base debit, including base commission.")
  assert.equal(result.legacy.eligible, false, "A base commission that makes the legacy slice loss-making must fail its independent gate.")
})

test("rejects legacy quote proceeds when no legacy base quantity was debited", () => {
  assert.throws(
    () => calculateProfitability({
      legacyBaseDebit: "0",
      legacyNetQuoteProceeds: "0.01",
    }),
    /Legacy quote proceeds require a positive legacy base debit/,
    "Legacy proceeds must never be attributed to a zero-quantity legacy allocation.",
  )
})

test("rejects negative recovery net quote proceeds", () => {
  assert.throws(
    () => calculateProfitability({
      recoveryNetQuoteProceeds: "-0.01",
    }),
    /non-negative/,
    "Negative net recovery proceeds are invalid evidence and must fail closed before profitability is calculated.",
  )
})

test("rejects negative legacy net quote proceeds", () => {
  assert.throws(
    () => calculateProfitability({
      legacyNetQuoteProceeds: "-0.01",
    }),
    /non-negative/,
    "Negative net legacy proceeds are invalid evidence and must fail closed before profitability is calculated.",
  )
})

test("rejects a negative recovery cost basis", () => {
  assert.throws(
    () => calculateProfitability({
      recoveryCostBasis: "-1",
    }),
    /non-negative/,
    "A negative recovery cost basis is invalid and must not produce a profitability decision.",
  )
})

test("rejects a zero recovery cost basis", () => {
  assert.throws(
    () => calculateProfitability({
      recoveryCostBasis: "0",
    }),
    /recoveryCostBasis must be positive/,
    "A recovery tranche without a positive acquired cost basis must be rejected.",
  )
})

test("rejects a zero minimum recovery profit threshold", () => {
  assert.throws(
    () => calculateProfitability({
      minProfit: "0",
    }),
    /minProfit must be positive|greater than zero/,
    "The existing pair-level minProfit must remain strictly positive.",
  )
})

test("rejects a negative minimum recovery profit threshold", () => {
  assert.throws(
    () => calculateProfitability({
      minProfit: "-0.01",
    }),
    /non-negative/,
    "A negative pair-level minProfit must not weaken the recovery profitability gate.",
  )
})

test("rejects a negative legacy average cost even when the legacy allocation is otherwise valid", () => {
  assert.throws(
    () => calculateProfitability({
      legacyAverageCost: "-2",
    }),
    /non-negative/,
    "A negative fixed legacy average acquisition cost is invalid and must fail closed.",
  )
})

test("rejects a negative legacy base debit", () => {
  assert.throws(
    () => calculateProfitability({
      legacyBaseDebit: "-0.1",
    }),
    /non-negative/,
    "A negative legacy base debit is invalid evidence and must not be used for historical cost accounting.",
  )
})

test("rejects a zero legacy average cost when legacy inventory is debited", () => {
  assert.throws(
    () => calculateProfitability({
      legacyAverageCost: "0",
    }),
    /legacyAverageCost must be positive when legacy base is debited/,
    "A positive legacy base debit requires a positive fixed original average acquisition cost.",
  )
})
