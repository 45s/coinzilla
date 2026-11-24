import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { updateTradingAccounting } from "./update-trading-accounting.js"

const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const thirdAsset = new Asset({ id: "bnb", code: "BNB" })
const market = new Market({
  venue: "binance",
  symbol: "DOGEUSDT",
  baseAsset,
  quoteAsset,
})

function createBuyFill({ tradeId, price, quantity, quoteQuantity, commissions = [] }) {
  return new Fill({
    tradeId,
    brokerOrderId: "standing-buy-order",
    market,
    side: "BUY",
    price: new Money({ amount: price, asset: quoteAsset }),
    quantity: new Quantity({ amount: quantity, asset: baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
    commissions,
    commissionStatus: "COMPLETE",
  })
}

function applyBuy({ state, fill }) {
  const result = updateTradingAccounting({
    portfolio: state.portfolio,
    recoveryLedger: state.recoveryLedger,
    fill,
  })
  assert.equal(result.ok, true, "A valid BUY execution must update both accounting projections.")
  assert.equal(result.data.applied, true, "A new execution must be applied exactly once.")
  return {
    portfolio: result.data.portfolio,
    recoveryLedger: result.data.recoveryLedger,
  }
}

test("a second BUY extends the first tranche's net inventory and recovery cost without resetting either", () => {
  const initial = applyBuy({
    state: {
      portfolio: new Portfolio(),
      recoveryLedger: RecoveryLedger.empty({ market }),
    },
    fill: createBuyFill({
      tradeId: "first-buy-fill",
      price: "0.1",
      quantity: "100",
      quoteQuantity: "10",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.1", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) }),
        new Commission({
          amount: new Money({ amount: "0.001", asset: thirdAsset }),
          quoteValue: new Money({ amount: "0.02", asset: quoteAsset }),
        }),
      ],
    }),
  })

  const afterSecondBuy = applyBuy({
    state: initial,
    fill: createBuyFill({
      tradeId: "second-buy-fill",
      price: "0.12",
      quantity: "50",
      quoteQuantity: "6",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.05", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.006", asset: quoteAsset }) }),
        new Commission({
          amount: new Money({ amount: "0.002", asset: thirdAsset }),
          quoteValue: new Money({ amount: "0.03", asset: quoteAsset }),
        }),
      ],
    }),
  })

  const position = afterSecondBuy.portfolio.getPosition({ marketId: market.id })
  assert.equal(
    position.baseQuantity.amount,
    "149.85",
    "The second BUY must add its net base quantity to the first BUY's remaining inventory.",
  )
  assert.equal(
    position.spent.amount,
    "16.066",
    "The cumulative basis must retain the first tranche and add the second gross quote cost plus all valued fees.",
  )
  assert.equal(
    position.quoteNetCashFlow.amount,
    "-16.066",
    "Cumulative BUY quote cash flow must reconcile to both tranches' complete quote-denominated cost.",
  )
  assert.equal(
    afterSecondBuy.recoveryLedger.buyCost,
    "16.066",
    "The RecoveryLedger must extend, not reset, the first BUY's recovery basis.",
  )
  assert.deepEqual(
    afterSecondBuy.portfolio.appliedFillIds,
    ["binance:DOGEUSDT:first-buy-fill", "binance:DOGEUSDT:second-buy-fill"],
    "Portfolio must retain both canonical execution identities in order.",
  )
  assert.deepEqual(
    afterSecondBuy.recoveryLedger.appliedFillIds,
    ["binance:DOGEUSDT:first-buy-fill", "binance:DOGEUSDT:second-buy-fill"],
    "RecoveryLedger must retain the same two canonical execution identities.",
  )
})
