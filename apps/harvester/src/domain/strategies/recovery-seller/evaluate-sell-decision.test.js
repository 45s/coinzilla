import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Market, Money, Quantity, TradingRules } from "@coinzilla/entities"
import { createRecoverySellerCycleState } from "./cycle-state.js"
import { evaluateRecoverySellerSellDecision } from "./evaluate-sell-decision.js"
import { createRecoverySellerStopState } from "./stop-decision.js"

const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({
  venue: "binance",
  symbol: "DOGEUSDT",
  baseAsset,
  quoteAsset,
})

function createTradingRules({ minimumPrice = "0.01", maximumPrice = "100", minimumQuantity = "0.01", maximumQuantity = "100", minimumNotional = "5", maximumNotional = "1000", missingFilter, supportedOrderTypes = ["LIMIT_MAKER", "LIMIT"] } = {}) {
  return {
    market,
    supportedOrderTypes,
    tradingRules: new TradingRules({
      market,
      constraints: [
        { type: "PRICE_INCREMENT", status: "SUPPORTED", value: new Money({ amount: "0.01", asset: quoteAsset }) },
        { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: new Quantity({ amount: "0.01", asset: baseAsset }) },
        { type: "MIN_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: minimumQuantity, asset: baseAsset }) },
        { type: "MIN_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: minimumNotional, asset: quoteAsset }) },
        { type: "MAX_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: maximumQuantity, asset: baseAsset }) },
        { type: "MAX_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: maximumNotional, asset: quoteAsset }) },
        { type: "MIN_PRICE", status: "SUPPORTED", value: new Money({ amount: minimumPrice, asset: quoteAsset }) },
        { type: "MAX_PRICE", status: "SUPPORTED", value: new Money({ amount: maximumPrice, asset: quoteAsset }) },
      ].filter(({ type }) => type !== missingFilter),
    }),
  }
}

const validInput = {
  pairConfig: { makerPercent: 0, takerPercent: 0.075 },
  marketMetadata: createTradingRules(),
  cycleState: createRecoverySellerCycleState({ cycleId: "cycle-1", positionId: "position-1" }),
  stopState: createRecoverySellerStopState(),
  planInput: {
    recoveryQuantity: "1",
    configuredLegacyQuantity: "0.01",
    legacyRemainingQuantity: "0",
    verifiedUnreservedLegacyQuantity: "0",
    recoveryCostBasis: "10",
    legacyAverageCost: "0",
    minProfit: "0.01",
    thirdAssetFeeQuoteValue: "0",
  },
}

test("selects post-only SELL and maker fee reserve when makerPercent is zero", () => {
  const result = evaluateRecoverySellerSellDecision(validInput)

  assert.equal(result.decision.outcome, "SUBMIT",
    "A valid recovery SELL with available post-only support must produce one eligible intent.")
  assert.equal(result.orderIntent.type, "LIMIT_MAKER",
    "A zero configured makerPercent must select the Conservative post-only order type.")
  assert.equal(result.orderIntent.quoteFeeRate, "0",
    "A post-only SELL must reserve the configured maker fee, including a zero maker fee.")
  assert.equal(result.orderIntent.baseFeeRate, "0",
    "Base-fee quantity planning must use the same configured maker reserve for a post-only SELL.")
})

test("selects ordinary LIMIT and the higher configured fee when makerPercent is non-zero", () => {
  const result = evaluateRecoverySellerSellDecision({
    ...validInput,
    pairConfig: { makerPercent: 0.075, takerPercent: 0.2 },
  })

  assert.equal(result.decision.outcome, "SUBMIT",
    "A valid ordinary LIMIT recovery SELL must remain eligible when all filters pass.")
  assert.equal(result.orderIntent.type, "LIMIT",
    "A non-zero makerPercent must select ordinary LIMIT exactly as Conservative does.")
  assert.equal(result.orderIntent.quoteFeeRate, "0.002",
    "An ordinary LIMIT SELL must reserve the higher configured maker/taker fee.")
  assert.equal(result.orderIntent.baseFeeRate, "0.002",
    "The base-asset fee allowance must use the same worst-case configured rate.")
})

test("latches global STOP instead of submitting a SELL that violates MIN_NOTIONAL", () => {
  const result = evaluateRecoverySellerSellDecision({
    ...validInput,
    marketMetadata: createTradingRules({ minimumNotional: "20" }),
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "An exchange-filter violation must block the proposed SELL rather than adjust or split it.")
  assert.equal(result.stopState.status, "STOPPED",
    "An exchange-filter violation must latch the global sticky RS STOP state.")
  assert.equal(result.orderIntent, undefined,
    "No executable SELL intent may escape an exchange-filter violation.")
})

test("latches global STOP when the exchange does not support the configured SELL order type", () => {
  const result = evaluateRecoverySellerSellDecision({
    ...validInput,
    marketMetadata: createTradingRules({ supportedOrderTypes: ["LIMIT"] }),
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "An unsupported required order type must block the RS SELL policy.")
  assert.equal(result.stopState.status, "STOPPED",
    "An unsupported order type is an uncovered exchange condition and must latch STOP.")
  assert.equal(result.orderIntent, undefined,
    "The policy must not return a SELL intent for an unsupported order type.")
})

test("blocks a second SELL lifecycle without creating another order intent", () => {
  const result = evaluateRecoverySellerSellDecision({
    ...validInput,
    cycleState: Object.freeze({
      ...validInput.cycleState,
      status: "SELL_SUBMITTED",
      sellOrderIdentity: Object.freeze({ clientOrderId: "h-existing" }),
    }),
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "A cycle with its sole SELL already submitted must not produce a second SELL.")
  assert.equal(result.stopState.status, "STOPPED",
    "A second SELL attempt is an unsupported lifecycle transition and must latch STOP.")
  assert.equal(result.orderIntent, undefined,
    "A second SELL intent must never be returned for the same recovery cycle.")
})

test("latches STOP for every supported minimum and maximum SELL filter violation", () => {
  const scenarios = [
    { filter: "MIN_PRICE", metadata: createTradingRules({ minimumPrice: "11" }) },
    { filter: "MAX_PRICE", metadata: createTradingRules({ maximumPrice: "10" }) },
    { filter: "MIN_QUANTITY", metadata: createTradingRules({ minimumQuantity: "2" }) },
    { filter: "MAX_QUANTITY", metadata: createTradingRules({ maximumQuantity: "0.5" }) },
    { filter: "MIN_NOTIONAL", metadata: createTradingRules({ minimumNotional: "20" }) },
    { filter: "MAX_NOTIONAL", metadata: createTradingRules({ maximumNotional: "5" }) },
  ]

  for (const scenario of scenarios) {
    const result = evaluateRecoverySellerSellDecision({
      ...validInput,
      marketMetadata: scenario.metadata,
    })

    assert.equal(result.decision.outcome, "BLOCK",
      "A " + scenario.filter + " violation must block the SELL without adjusting its quantity or price.")
    assert.equal(result.stopState.status, "STOPPED",
      "A " + scenario.filter + " violation must latch the global sticky STOP.")
    assert.equal(result.orderIntent, undefined,
      "A " + scenario.filter + " violation must not return an executable SELL intent.")
  }
})

test("latches STOP when a required exchange filter is unavailable", () => {
  const result = evaluateRecoverySellerSellDecision({
    ...validInput,
    marketMetadata: createTradingRules({ missingFilter: "MIN_NOTIONAL" }),
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "A missing required exchange filter must block SELL planning.")
  assert.equal(result.stopState.status, "STOPPED",
    "Missing authoritative exchange constraints must latch the global STOP.")
  assert.equal(result.orderIntent, undefined,
    "The evaluator must not return an order intent without every required filter.")
})

test("latches STOP when third-asset commission quote valuation is missing", () => {
  const planInput = { ...validInput.planInput }
  delete planInput.thirdAssetFeeQuoteValue
  const result = evaluateRecoverySellerSellDecision({
    ...validInput,
    planInput,
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "An unvalued third-asset commission must fail closed before SELL authorization.")
  assert.equal(result.stopState.status, "STOPPED",
    "Missing third-asset quote valuation must latch the global STOP.")
  assert.equal(result.orderIntent, undefined,
    "The evaluator must not treat missing third-asset valuation as zero or submit.")
})
