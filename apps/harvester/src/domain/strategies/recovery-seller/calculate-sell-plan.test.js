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


test("returns a frozen deterministic plan without mutating caller input", () => {
  const input = Object.freeze({ ...validInput })
  const first = calculateRecoverySellerSellPlan(input)
  const second = calculateRecoverySellerSellPlan(input)

  assert.equal(Object.isFrozen(first), true,
    "The SELL plan must be immutable before any application workflow consumes it.")
  assert.deepEqual(second, first,
    "Identical immutable inputs must produce identical deterministic plans.")
  assert.equal(input.legacyRemainingQuantity, "0.01",
    "Planning must not mutate the caller's authorized legacy remainder.")
  assert.equal(input.verifiedUnreservedLegacyQuantity, "0.01",
    "Planning must not mutate the verified Spot custody snapshot.")
})

test("raises the SELL target to prevent recovery profit subsidizing a legacy loss", () => {
  const plan = calculateRecoverySellerSellPlan(validInput)

  assert.equal(plan.recoveryRequiredNetQuoteProceeds, "10.1101",
    "Recovery's allocated proceeds must independently cover recovery cost plus minProfit.")
  assert.equal(plan.legacyRequiredNetQuoteProceeds, "20.2",
    "Legacy's allocated proceeds must independently recover its fixed historical cost.")
  assert.equal(plan.combinedRequiredNetQuoteProceeds, "10.21",
    "The combined cycle must independently recover both costs plus minProfit.")
  assert.equal(plan.requiredNetQuoteProceeds, "20.2",
    "The SELL target must be the greatest of the three applicable profitability targets.")
  assert.equal(plan.grossQuoteProceeds, "20.2",
    "With no quote or third-asset fee, gross proceeds equal the required net proceeds.")
  assert.equal(plan.quantity, "1.01",
    "The SELL quantity must contain the full recovery tranche and authorized legacy slice.")
  assert.equal(plan.price, "20",
    "The minimum price must satisfy the stricter legacy allocation gate.")
})

test("raises the SELL target to prevent legacy profit subsidizing a recovery shortfall", () => {
  const plan = calculateRecoverySellerSellPlan({
    ...validInput,
    legacyAverageCost: "0.01",
  })

  assert.equal(plan.recoveryRequiredNetQuoteProceeds, "10.1101",
    "Recovery allocation must receive enough proceeds to earn minProfit independently.")
  assert.equal(plan.legacyRequiredNetQuoteProceeds, "0.0101",
    "The legacy target must use its fixed historical cost, not recovery cost.")
  assert.equal(plan.combinedRequiredNetQuoteProceeds, "10.0101",
    "Combined target remains separately visible.")
  assert.equal(plan.requiredNetQuoteProceeds, "10.1101",
    "The recovery allocation target must dominate when legacy cost is too small.")
  assert.equal(plan.price, "10.01",
    "The minimum price must satisfy recovery profitability even when legacy is profitable.")
})

test("grosses up quote commission after applying all independent profitability targets", () => {
  const plan = calculateRecoverySellerSellPlan({
    ...validInput,
    quoteFeeRate: "0.01",
  })

  assert.equal(plan.requiredNetQuoteProceeds, "20.2",
    "Quote fees must not change the required net allocation proceeds.")
  assert.equal(plan.grossQuoteProceeds, "20.404040404040404040404040404040404041",
    "Gross quote proceeds must cover the stricter legacy target after quote commission.")
  assert.equal(plan.price, "20.21",
    "The fee-adjusted price must round upward to the exchange tick.")
})


test("grosses up quote and third-asset fees after selecting the strictest allocation target", () => {
  const plan = calculateRecoverySellerSellPlan({
    ...validInput,
    quoteFeeRate: "0.01",
    thirdAssetFeeQuoteValue: "0.05",
  })

  assert.equal(plan.requiredNetQuoteProceeds, "20.2",
    "The stricter legacy allocation target must be selected before fee gross-up.")
  assert.equal(plan.grossQuoteProceeds, "20.454545454545454545454545454545454546",
    "Quote and third-asset fees must be added after selecting the max allocation target.")
  assert.equal(plan.price, "20.26",
    "The fee-adjusted mixed SELL price must round upward to the configured tick.")
})

test("adds a reliably quote-valued third-asset commission to gross proceeds", () => {
  const plan = calculateRecoverySellerSellPlan({
    ...validInput,
    recoveryQuantity: "1",
    legacyRemainingQuantity: "0",
    verifiedUnreservedLegacyQuantity: "0",
    thirdAssetFeeQuoteValue: "0.05",
  })

  assert.equal(plan.requiredNetQuoteProceeds, "10.01",
    "Recovery-only target must include the configured minimum profit.")
  assert.equal(plan.grossQuoteProceeds, "10.06",
    "Third-asset commission value must be added to required gross proceeds.")
  assert.equal(plan.price, "10.06",
    "The price must cover the quote-valued third-asset fee.")
})

test("grosses up base-asset commission without dropping the authorized legacy slice", () => {
  const plan = calculateRecoverySellerSellPlan({
    ...validInput,
    baseFeeRate: "0.01",
  })

  assert.equal(plan.quantity, "1",
    "Exchange-aligned SELL quantity must not exceed verified available base.")
  assert.equal(plan.baseFeeQuantity, "0.01",
    "Base fee quantity must be calculated from the gross SELL quantity.")
  assert.equal(plan.baseDebitQuantity, "1.01",
    "Base debit must include the actual base-denominated fee allowance.")
  assert.equal(plan.legacyQuantity, "0.01",
    "The authorized legacy slice must remain included.")
  assert.equal(plan.legacyBaseDebitQuantity, "0.01",
    "Legacy base debit must include its allocated base commission without exceeding the authorized legacy quantity.")
  assert.equal(plan.legacyRequiredNetQuoteProceeds, plan.requiredNetQuoteProceeds,
    "The legacy target must include the base-fee-adjusted historical cost.")
  assert.equal(plan.recoveryRequiredNetQuoteProceeds, "10.1101",
    "Recovery target must remain independent of the legacy allocation after exact base-fee allocation.")
  assert.notEqual(plan.legacySellQuantity, "0",
    "The eligible legacy slice must remain in the mixed SELL after base-fee gross-up.")
})

test("rounds the minimum price upward to the exchange price tick", () => {
  const plan = calculateRecoverySellerSellPlan({
    ...validInput,
    priceTickSize: "0.1",
  })

  assert.equal(plan.requiredNetQuoteProceeds, "20.2",
    "The required proceeds must satisfy the stricter independent legacy gate.")
  assert.equal(plan.price, "20",
    "The calculated minimum price must be rounded upward to the configured tick.")
})

test("fails closed when the quantity step cannot include the full base-fee-adjusted inventory", () => {
  assert.throws(
    () => calculateRecoverySellerSellPlan({
      ...validInput,
      baseFeeRate: "0.02",
      quantityStepSize: "0.1",
    }),
    /cannot include the full recovery and authorized legacy quantities/,
    "The planner must not oversell or silently omit inventory to fit a quantity step.",
  )
})

test("uses the smaller remaining authorized legacy quantity", () => {
  const plan = calculateRecoverySellerSellPlan({
    ...validInput,
    configuredLegacyQuantity: "0.05",
    legacyRemainingQuantity: "0.01",
    verifiedUnreservedLegacyQuantity: "0.01",
  })

  assert.equal(plan.legacyQuantity, "0.01",
    "Legacy quantity must be capped at the smaller authorized remainder.")
  assert.equal(plan.legacyCostBasis, "0.2",
    "Historical cost must use the fixed average for the actual allocated quantity.")
  assert.equal(plan.requiredNetQuoteProceeds, "20.2",
    "The smaller legacy slice must still pass its independent non-loss gate.")
})

test("does not silently omit authorized legacy inventory when Spot availability is unverified or reserved", () => {
  assert.throws(
    () => calculateRecoverySellerSellPlan({
      ...validInput,
      verifiedUnreservedLegacyQuantity: "0",
    }),
    /Authorized legacy inventory remains/,
    "Missing verified unreserved Spot custody must block mixed SELL planning.",
  )
})

test("allows recovery-only SELL only after the authorized legacy quantity is exhausted", () => {
  const plan = calculateRecoverySellerSellPlan({
    ...validInput,
    legacyRemainingQuantity: "0",
    verifiedUnreservedLegacyQuantity: "0",
  })

  assert.equal(plan.legacyQuantity, "0",
    "No legacy quantity may be added after its authorized allocation is exhausted.")
  assert.equal(plan.quantity, "1",
    "Recovery-only quantity must remain the actual recovery inventory.")
  assert.equal(plan.recoveryRequiredNetQuoteProceeds, "10.01",
    "Recovery-only operation must still meet the recovery minProfit gate.")
  assert.equal(plan.legacyRequiredNetQuoteProceeds, "0",
    "The legacy profitability gate is not applicable after exhaustion.")
  assert.equal(plan.combinedRequiredNetQuoteProceeds, "10.01",
    "Recovery-only combined target must include recovery cost and minProfit.")
  assert.equal(plan.requiredNetQuoteProceeds, "10.01",
    "Recovery-only planning must continue using the recovery and combined gates.")
})


test("fails closed when decimal precision cannot represent the authorized legacy allocation", () => {
  assert.throws(
    () => calculateRecoverySellerSellPlan({
      ...validInput,
      configuredLegacyQuantity: "0.0000000000000000000000000000000000001",
      legacyRemainingQuantity: "0.0000000000000000000000000000000000001",
      verifiedUnreservedLegacyQuantity: "0.0000000000000000000000000000000000001",
      quantityStepSize: "0.0001",
    }),
    /precision cannot represent the authorized legacy allocation/,
    "Rounding must never allocate more legacy base than verified Spot custody authorizes.",
  )
})

test("fails closed when decimal precision would omit the recovery allocation", () => {
  assert.throws(
    () => calculateRecoverySellerSellPlan({
      ...validInput,
      recoveryQuantity: "0.0000000000000000000000000000000000001",
      configuredLegacyQuantity: "1",
      legacyRemainingQuantity: "1",
      verifiedUnreservedLegacyQuantity: "1",
      quantityStepSize: "0.0001",
    }),
    /precision cannot represent the recovery allocation/,
    "Rounding must not silently assign the entire mixed SELL to legacy inventory.",
  )
})

test("rejects invalid fee rates and missing third-asset quote valuation input", () => {
  assert.throws(
    () => calculateRecoverySellerSellPlan({
      ...validInput,
      quoteFeeRate: "1",
    }),
    /quoteFeeRate/,
    "Quote fee rates at or above 100% cannot produce a valid net-proceeds plan.",
  )
  assert.throws(
    () => calculateRecoverySellerSellPlan({
      ...validInput,
      thirdAssetFeeQuoteValue: undefined,
    }),
    /thirdAssetFeeQuoteValue/,
    "Missing third-asset valuation must not be treated as a zero fee.",
  )
})

test("rejects minProfit below the existing Conservative quote-asset minimum", () => {
  assert.throws(
    () => calculateRecoverySellerSellPlan({
      ...validInput,
      minProfit: "0.009",
    }),
    /minProfit must be at least 0.01/,
    "Recovery Seller must enforce the existing per-pair minimum profit floor rather than accepting a smaller positive amount.",
  )
})
