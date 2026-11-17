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

test("one combined gate accepts recovery profit covering a small legacy loss", () => {
  const result = calculateRecoverySellerProfitability(validInput)

  assert.equal(result.recovery.netProfit, "0.15")
  assert.equal(result.legacy.costBasis, "0.2")
  assert.equal(result.legacy.netProfit, "-0.01")
  assert.equal(result.cycle.costBasis, "10.2")
  assert.equal(result.cycle.netQuoteProceeds, "10.34")
  assert.equal(result.cycle.netProfit, "0.14")
  assert.equal(result.cycle.minProfit, "0.01")
  assert.equal(result.cycle.eligible, true)
  assert.equal(result.eligible, true)
})

test("one combined gate rejects the SELL when total profit misses minProfit", () => {
  const result = calculateRecoverySellerProfitability({
    ...validInput,
    recoveryNetQuoteProceeds: "10.019",
    legacyNetQuoteProceeds: "0.19",
  })

  assert.equal(result.recovery.netProfit, "0.019")
  assert.equal(result.legacy.netProfit, "-0.01")
  assert.equal(result.cycle.netProfit, "0.009")
  assert.equal(result.cycle.eligible, false)
  assert.equal(result.eligible, false)
})

test("recovery-only cycles use the same combined gate with zero legacy cost", () => {
  const result = calculateRecoverySellerProfitability({
    ...validInput,
    recoveryNetQuoteProceeds: "10.01",
    legacyBaseDebit: "0",
    legacyNetQuoteProceeds: "0",
  })

  assert.equal(result.cycle.costBasis, "10")
  assert.equal(result.cycle.netProfit, "0.01")
  assert.equal(result.cycle.eligible, true)
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
