import nodeTest from "node:test"
const test = (name, ...args) => nodeTest("[recovery-sell-plan-accounting.test.js] " + name, ...args)
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../../portfolio/portfolio.js"
import { RecoveryLedger } from "./recovery-ledger.js"
import { calculateRecoverySellPlan } from "./recovery-sell-plan.js"
import { evaluateRecoveryCompletion } from "./recovery-completion.js"
import { updateTradingAccounting } from "../../../use-cases/update-trading-accounting.js"

const baseAsset = new Asset({ id: "asset:DOGE", code: "DOGE" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })

function createInitialAccounting(tradeId, { baseCommission = "0" } = {}) {
  const result = updateTradingAccounting({
    portfolio: new Portfolio(),
    recoveryLedger: RecoveryLedger.empty({ market }),
    fill: new Fill({
      tradeId,
      brokerOrderId: "buy-order-" + tradeId,
      clientOrderId: "buy-client-" + tradeId,
      market,
      side: "BUY",
      price: new Money({ amount: "0.8", asset: quoteAsset }),
      quantity: new Quantity({ amount: "11.1", asset: baseAsset }),
      quoteQuantity: new Money({ amount: "8.88", asset: quoteAsset }),
      commissions: baseCommission === "0" ? [] : [
        new Commission({ amount: new Money({ amount: baseCommission, asset: baseAsset }) }),
      ],
      commissionStatus: "COMPLETE",
      executedAt: 1,
    }),
  })
  assert.equal(result.ok, true)
  return result.data
}

function createPlan({ minProfit }) {
  return calculateRecoverySellPlan({
    activeQuantity: "11.1",
    keepQuantity: "1",
    positionSpent: "8.88",
    saleProceeds: "0",
    minProfit,
    feeRate: "0.01",
    priceTickSize: "0.001",
    quantityStepSize: "0.1",
  })
}

function applySellFill(state, {
  tradeId,
  quantity = "10",
  quoteQuantity,
  price,
  commissionAsset,
  commissionAmount,
}) {
  const fill = new Fill({
    tradeId,
    brokerOrderId: "sell-order-" + tradeId,
    clientOrderId: "sell-client-" + tradeId,
    market,
    side: "SELL",
    price: new Money({ amount: price, asset: quoteAsset }),
    quantity: new Quantity({ amount: quantity, asset: baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
    commissions: commissionAmount === "0" ? [] : [
      new Commission({
        amount: new Money({ amount: commissionAmount, asset: commissionAsset }),
      }),
    ],
    commissionStatus: "COMPLETE",
    executedAt: 2,
  })
  const result = updateTradingAccounting({
    portfolio: state.portfolio,
    recoveryLedger: state.recoveryLedger,
    fill,
  })
  assert.equal(result.ok, true)
  return result.data
}

function evaluateCompletion(state, minProfit) {
  const position = state.portfolio.getPosition({ marketId: market.id })
  return evaluateRecoveryCompletion({
    sellOrderFullyFilled: true,
    spent: state.recoveryLedger.buyCost,
    netSellProceeds: state.recoveryLedger.netSellProceeds,
    activeQuantity: position.baseQuantity.amount,
    keepQuantity: "1",
    minProfit,
  })
}

test("base-asset SELL commission and quantity-step rounding preserve keepQuantity exactly", () => {
  const plan = createPlan({ minProfit: "1.021" })
  assert.deepEqual(plan, {
    quantity: "10",
    price: "1.001",
    requiredNetProceeds: "9.901",
  }, "The planned SELL must reserve base commission and recover the full cost plus minProfit.")

  const initial = createInitialAccounting("base-commission-buy")
  const completed = applySellFill(initial, {
    tradeId: "base-commission-sell",
    quoteQuantity: "10.01",
    price: plan.price,
    commissionAsset: baseAsset,
    commissionAmount: "0.1",
  })
  const position = completed.portfolio.getPosition({ marketId: market.id })
  const completion = evaluateCompletion(completed, "1.021")

  assert.equal(position.baseQuantity.amount, "1", "The base commission and SELL quantity must leave exactly keepQuantity active.")
  assert.equal(completed.recoveryLedger.netSellProceeds, "10.01", "Base-asset SELL commission must not reduce quote recovery proceeds.")
  assert.equal(completion.eligible, true, "The completed SELL must satisfy the recovery profit and retained-inventory conditions.")
  assert.equal(completion.realizedNetProfit, "1.13", "Realized profit must equal 10.01 net proceeds less 8.88 spent.")

  const oneStepTooMuch = applySellFill(initial, {
    tradeId: "base-commission-sell-too-much",
    quantity: "10.1",
    quoteQuantity: "10.1101",
    price: plan.price,
    commissionAsset: baseAsset,
    commissionAmount: "0.101",
  })
  const overdrawnCompletion = evaluateCompletion(oneStepTooMuch, "1.021")

  assert.equal(oneStepTooMuch.portfolio.getPosition({ marketId: market.id }).baseQuantity.amount, "0.899", "One additional quantity step must leave less than keepQuantity after base commission.")
  assert.equal(overdrawnCompletion.eligible, false, "Completion must be rejected when active inventory is below keepQuantity.")
  assert.equal(overdrawnCompletion.reason, "INSUFFICIENT_ACTIVE_INVENTORY_FOR_FREE_ALLOCATION", "The precise completion blocker must identify the retained-inventory shortfall.")
})

test("quote-asset SELL commission and price-tick rounding meet the net-profit boundary", () => {
  const plan = createPlan({ minProfit: "1.021" })
  assert.equal(plan.quantity, "10", "The recovery plan must sell the full valid quantity above keepQuantity.")
  assert.equal(plan.price, "1.001", "The recovery price must round up to the next price tick.")

  const initial = createInitialAccounting("quote-commission-buy")
  const quoteCommission = "0.1001"
  const completed = applySellFill(initial, {
    tradeId: "quote-commission-sell",
    quoteQuantity: "10.01",
    price: plan.price,
    commissionAsset: quoteAsset,
    commissionAmount: quoteCommission,
  })
  const completion = evaluateCompletion(completed, "1.021")

  assert.equal(completed.recoveryLedger.netSellProceeds, "9.9099", "The 10.01 quote proceeds less the independently supplied 0.1001 commission must equal 9.9099.")
  assert.equal(completion.eligible, false, "Residual active inventory must prevent recovery completion even after the profit target is met.")
  assert.equal(completion.pause, false, "Sell-through residual inventory must continue without pausing the market.")
  assert.equal(completion.reason, "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH", "The remaining active inventory must be classified for sell-through.")
  assert.equal(completion.realizedNetProfit, "1.0299", "Realized profit must use the actual quote commission supplied in the fill fixture.")

  const oneTickLower = "1"
  const belowTick = applySellFill(initial, {
    tradeId: "quote-commission-sell-below-tick",
    quoteQuantity: "10",
    price: oneTickLower,
    commissionAsset: quoteAsset,
    commissionAmount: "0.1",
  })
  const belowCompletion = evaluateCompletion(belowTick, "1.021")

  assert.equal(belowTick.recoveryLedger.netSellProceeds, "9.9", "At the one-tick-lower price, 10 quote proceeds less 0.1 commission must equal 9.9.")
  assert.equal(belowCompletion.eligible, false, "A net profit below the configured 1.021 target must not complete recovery.")
  assert.equal(belowCompletion.reason, "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY", "The one-tick-lower result must remain in recovery for the exact profit shortfall.")
  assert.equal(belowCompletion.realizedNetProfit, "1.02", "The one-tick-lower realized profit must be exactly 1.02.")
})

test("exact minProfit equality remains eligible after actual quote commission", () => {
  const plan = createPlan({ minProfit: "1.02" })
  assert.equal(plan.price, "1", "Exact minProfit equality must require the 1.000 quote price.")
  assert.equal(plan.requiredNetProceeds, "9.9", "The required net proceeds must equal the 8.88 cost plus 1.02 profit.")

  const initial = createInitialAccounting("exact-profit-buy", { baseCommission: "0.1" })
  const completed = applySellFill(initial, {
    tradeId: "exact-profit-sell",
    quoteQuantity: "10",
    price: plan.price,
    commissionAsset: quoteAsset,
    commissionAmount: "0.1",
  })
  const completion = evaluateCompletion(completed, "1.02")

  assert.equal(completed.recoveryLedger.netSellProceeds, "9.9", "Gross proceeds of 10 less the 0.1 actual quote commission must equal 9.9 net.")
  assert.equal(completion.eligible, true, "Recovery must accept exact equality with the 1.02 minimum profit.")
  assert.equal(completion.realizedNetProfit, "1.02", "Realized net profit must equal the configured minimum exactly.")
})
