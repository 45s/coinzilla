import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { multiplyDecimal, subtractDecimal } from "@coinzilla/utils"
import { Portfolio } from "../../portfolio/portfolio.js"
import { RecoveryLedger } from "./recovery-ledger.js"
import { calculateRecoverySellPlan } from "./recovery-sell-plan.js"
import { evaluateRecoveryCompletion } from "./recovery-completion.js"
import { updateTradingAccounting } from "../../../use-cases/update-trading-accounting.js"

const baseAsset = new Asset({ id: "asset:DOGE", code: "DOGE" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })

function createInitialAccounting(tradeId) {
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
      commissions: [],
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
    cycleCost: "8.88",
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
  price,
  commissionAsset,
  commissionAmount,
}) {
  const quoteQuantity = multiplyDecimal({ left: quantity, right: price })
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
    buyCost: state.recoveryLedger.buyCost,
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
  })

  const initial = createInitialAccounting("base-commission-buy")
  const completed = applySellFill(initial, {
    tradeId: "base-commission-sell",
    price: plan.price,
    commissionAsset: baseAsset,
    commissionAmount: "0.1",
  })
  const position = completed.portfolio.getPosition({ marketId: market.id })
  const completion = evaluateCompletion(completed, "1.021")

  assert.equal(position.baseQuantity.amount, "1")
  assert.equal(completed.recoveryLedger.netSellProceeds, "10.01")
  assert.equal(completion.eligible, true)
  assert.equal(completion.realizedNetProfit, "1.13")

  const oneStepTooMuch = applySellFill(initial, {
    tradeId: "base-commission-sell-too-much",
    quantity: "10.1",
    price: plan.price,
    commissionAsset: baseAsset,
    commissionAmount: "0.101",
  })
  const overdrawnCompletion = evaluateCompletion(oneStepTooMuch, "1.021")

  assert.equal(oneStepTooMuch.portfolio.getPosition({ marketId: market.id }).baseQuantity.amount, "0.899")
  assert.equal(overdrawnCompletion.eligible, false)
  assert.equal(overdrawnCompletion.reason, "INSUFFICIENT_ACTIVE_INVENTORY_FOR_FREE_ALLOCATION")
})

test("quote-asset SELL commission and price-tick rounding meet the net-profit boundary", () => {
  const plan = createPlan({ minProfit: "1.021" })
  assert.equal(plan.quantity, "10")
  assert.equal(plan.price, "1.001")

  const initial = createInitialAccounting("quote-commission-buy")
  const quoteCommission = multiplyDecimal({
    left: multiplyDecimal({ left: plan.quantity, right: plan.price }),
    right: "0.01",
  })
  const completed = applySellFill(initial, {
    tradeId: "quote-commission-sell",
    price: plan.price,
    commissionAsset: quoteAsset,
    commissionAmount: quoteCommission,
  })
  const completion = evaluateCompletion(completed, "1.021")

  assert.equal(completed.recoveryLedger.netSellProceeds, "9.9099")
  assert.equal(completion.eligible, true)
  assert.equal(completion.realizedNetProfit, "1.0299")

  const oneTickLower = subtractDecimal({ left: plan.price, right: "0.001" })
  const belowTick = applySellFill(initial, {
    tradeId: "quote-commission-sell-below-tick",
    price: oneTickLower,
    commissionAsset: quoteAsset,
    commissionAmount: "0.1",
  })
  const belowCompletion = evaluateCompletion(belowTick, "1.021")

  assert.equal(belowTick.recoveryLedger.netSellProceeds, "9.9")
  assert.equal(belowCompletion.eligible, false)
  assert.equal(belowCompletion.reason, "RECOVERY_SELL_FAILED_MIN_PROFIT")
  assert.equal(belowCompletion.realizedNetProfit, "1.02")
})

test("exact minProfit equality remains eligible after actual quote commission", () => {
  const plan = createPlan({ minProfit: "1.02" })
  assert.equal(plan.price, "1")
  assert.equal(plan.requiredNetProceeds, "9.9")

  const initial = createInitialAccounting("exact-profit-buy")
  const completed = applySellFill(initial, {
    tradeId: "exact-profit-sell",
    price: plan.price,
    commissionAsset: quoteAsset,
    commissionAmount: "0.1",
  })
  const completion = evaluateCompletion(completed, "1.02")

  assert.equal(completed.recoveryLedger.netSellProceeds, "9.9")
  assert.equal(completion.eligible, true)
  assert.equal(completion.realizedNetProfit, "1.02")
})
