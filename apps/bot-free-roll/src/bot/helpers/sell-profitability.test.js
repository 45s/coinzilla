import assert from "node:assert/strict"
import test from "node:test"
import {
  evaluateSellProfitability,
  SELL_PROFITABILITY_REASONS,
} from "./sell-profitability.js"

const baseInput = () => ({
  position: {
    baseAsset: "DOGE",
    quoteAsset: "USDT",
    activeQuantity: "100",
    keepQuantity: "1",
  },
  candidate: {
    quantity: "99",
    price: "0.11",
  },
  accounting: {
    cycleCost: "10",
    saleProceeds: "0",
  },
  feeAssumptions: [],
  valuationData: {
    baseToQuoteRate: "0.11",
  },
  tradingRules: {
    minNotional: "5",
    priceTickSize: "0.01",
    quantityStepSize: "1",
  },
  minProfit: "0.01",
})

test("approves a profitable sell and returns an exact calculation breakdown", () => {
  const decision = evaluateSellProfitability(baseInput())

  assert.equal(decision.approved, true)
  assert.deepEqual(decision.reasonCodes, [])
  assert.deepEqual(decision.breakdown, {
    candidateQuantity: "99",
    candidatePrice: "0.11",
    grossProceeds: "10.89",
    baseFeeQuantity: "0",
    quoteFeeAmount: "0",
    feeValueInQuote: "0",
    netProceeds: "10.89",
    inventoryRequired: "99",
    availableForSell: "99",
    cycleCost: "10",
    saleProceeds: "0",
    requiredNetProceeds: "10.01",
    projectedNetProfit: "0.89",
    minProfit: "0.01",
    minNotional: "5",
    priceTickSize: "0.01",
    quantityStepSize: "1",
    baseToQuoteRate: "0.11",
    notional: "10.89",
  })
})

test("values base-asset fees using the supplied base-to-quote valuation", () => {
  const input = baseInput()
  input.position.keepQuantity = "0.9"
  input.feeAssumptions = [{ asset: "DOGE", rate: "0.001" }]

  const decision = evaluateSellProfitability(input)

  assert.equal(decision.approved, true)
  assert.equal(decision.breakdown.baseFeeQuantity, "0.099")
  assert.equal(decision.breakdown.feeValueInQuote, "0.01089")
  assert.equal(decision.breakdown.inventoryRequired, "99.099")
  assert.equal(decision.breakdown.projectedNetProfit, "0.87911")
})

test("values quote-asset fees against gross quote proceeds", () => {
  const input = baseInput()
  input.feeAssumptions = [{ asset: "USDT", rate: "0.001" }]

  const decision = evaluateSellProfitability(input)

  assert.equal(decision.approved, true)
  assert.equal(decision.breakdown.quoteFeeAmount, "0.01089")
  assert.equal(decision.breakdown.baseFeeQuantity, "0")
  assert.equal(decision.breakdown.netProceeds, "10.87911")
})

test("rejects unsupported third-asset fee assumptions", () => {
  const input = baseInput()
  input.feeAssumptions = [{ asset: "BNB", rate: "0.001" }]

  const decision = evaluateSellProfitability(input)

  assert.equal(decision.approved, false)
  assert.deepEqual(decision.reasonCodes, [
    SELL_PROFITABILITY_REASONS.UNSUPPORTED_FEE_ASSET,
  ])
  assert.deepEqual(decision.details.unsupportedFeeAssets, ["BNB"])
  assert.equal(decision.breakdown.feeValueInQuote, null)
  assert.equal(decision.breakdown.netProceeds, null)
  assert.equal(decision.breakdown.projectedNetProfit, null)
})

test("rejects a candidate that consumes retained inventory or base-fee reserve", () => {
  const input = baseInput()
  input.candidate.quantity = "99.1"
  input.feeAssumptions = [{ asset: "DOGE", rate: "0.001" }]

  const decision = evaluateSellProfitability(input)

  assert.equal(decision.approved, false)
  assert.ok(decision.reasonCodes.includes(SELL_PROFITABILITY_REASONS.INSUFFICIENT_INVENTORY))
})

test("rejects a sell below the configured minimum net profit", () => {
  const input = baseInput()
  input.candidate.price = "0.10"

  const decision = evaluateSellProfitability(input)

  assert.equal(decision.approved, false)
  assert.ok(decision.reasonCodes.includes(SELL_PROFITABILITY_REASONS.BELOW_MIN_PROFIT))
})

test("rejects invalid exchange increments and minimum notional", () => {
  const input = baseInput()
  input.candidate.quantity = "99.5"
  input.candidate.price = "0.111"
  input.tradingRules.minNotional = "20"

  const decision = evaluateSellProfitability(input)

  assert.equal(decision.approved, false)
  assert.ok(decision.reasonCodes.includes(SELL_PROFITABILITY_REASONS.QUANTITY_STEP_MISMATCH))
  assert.ok(decision.reasonCodes.includes(SELL_PROFITABILITY_REASONS.PRICE_TICK_MISMATCH))
  assert.ok(decision.reasonCodes.includes(SELL_PROFITABILITY_REASONS.BELOW_MIN_NOTIONAL))
})

test("rejects fees that exceed proceeds", () => {
  const input = baseInput()
  input.valuationData.baseToQuoteRate = "2"
  input.feeAssumptions = [{ asset: "DOGE", rate: "0.9" }]

  const decision = evaluateSellProfitability(input)

  assert.equal(decision.approved, false)
  assert.ok(decision.reasonCodes.includes(SELL_PROFITABILITY_REASONS.FEES_EXCEED_PROCEEDS))
})

test("invalid inputs return an explicit rejection instead of throwing", () => {
  const input = baseInput()
  input.candidate.price = "not-a-number"

  const decision = evaluateSellProfitability(input)

  assert.equal(decision.approved, false)
  assert.deepEqual(decision.reasonCodes, [SELL_PROFITABILITY_REASONS.INVALID_INPUT])
  assert.equal(decision.breakdown, null)
})

test("does not mutate its input", () => {
  const input = baseInput()
  const before = structuredClone(input)

  evaluateSellProfitability(input)

  assert.deepEqual(input, before)
})
