import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { updateTradingAccounting } from "./update-trading-accounting.js"

const baseAsset = new Asset({
  id: "doge",
  code: "DOGE",
})
const quoteAsset = new Asset({
  id: "usdt",
  code: "USDT",
})
const thirdAsset = new Asset({
  id: "bnb",
  code: "BNB",
})
const market = new Market({
  venue: "binance",
  symbol: "DOGEUSDT",
  baseAsset,
  quoteAsset,
})

function makeBuyFill({
  tradeId,
  price,
  quantity,
  quoteQuantity,
  commissions = [],
} = {}) {
  return new Fill({
    tradeId,
    brokerOrderId: "completed-buy-1",
    market,
    side: "BUY",
    price: new Money({
      amount: price,
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: quantity,
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: quoteQuantity,
      asset: quoteAsset,
    }),
    commissions,
    commissionStatus: "COMPLETE",
  })
}

function applyBuyFill({ state, fill } = {}) {
  const result = updateTradingAccounting({
    portfolio: state.portfolio,
    recoveryLedger: state.recoveryLedger,
    fill,
  })
  assert.equal(
    result.ok,
    true,
    "A valid canonical BUY fill must update Portfolio and RecoveryLedger together.",
  )
  assert.equal(
    result.data.applied,
    true,
    "Each distinct BUY execution must be applied exactly once.",
  )
  return {
    portfolio: result.data.portfolio,
    recoveryLedger: result.data.recoveryLedger,
  }
}

function createFirstBuyState() {
  return applyBuyFill({
    state: {
      portfolio: new Portfolio(),
      recoveryLedger: RecoveryLedger.empty({ market }),
    },
    fill: makeBuyFill({
      tradeId: "buy-fill-1",
      price: "0.1",
      quantity: "100",
      quoteQuantity: "10",
      commissions: [
        new Commission({
          amount: new Money({
            amount: "0.1",
            asset: baseAsset,
          }),
        }),
        new Commission({
          amount: new Money({
            amount: "0.01",
            asset: quoteAsset,
          }),
        }),
        new Commission({
          amount: new Money({
            amount: "0.001",
            asset: thirdAsset,
          }),
          quoteValue: new Money({
            amount: "0.02",
            asset: quoteAsset,
          }),
        }),
      ],
    }),
  })
}

function assertFirstBuyAccounting({ state } = {}) {
  const position = state.portfolio.getPosition({ marketId: market.id })
  assert.equal(position.baseQuantity.amount, "99.9",
    "The first BUY must credit gross base quantity less its actual base-asset commission.")
  assert.equal(position.spent.amount, "10.03",
    "The first BUY cost must include gross quote spend, quote commission and valued third-asset commission.")
  assert.equal(position.quoteNetCashFlow.amount, "-10.03",
    "The first BUY quote cash flow must equal its complete quote-denominated cost.")
  assert.equal(state.recoveryLedger.buyCost, "10.03",
    "The RecoveryLedger cost mirror must match the first Position spent basis.")
}

function createCompletedBuyState({ state } = {}) {
  const afterSecondFill = applyBuyFill({
    state,
    fill: makeBuyFill({
      tradeId: "buy-fill-2",
      price: "0.12",
      quantity: "50",
      quoteQuantity: "6",
      commissions: [
        new Commission({
          amount: new Money({
            amount: "0.05",
            asset: baseAsset,
          }),
        }),
        new Commission({
          amount: new Money({
            amount: "0.006",
            asset: quoteAsset,
          }),
        }),
        new Commission({
          amount: new Money({
            amount: "0.002",
            asset: thirdAsset,
          }),
          quoteValue: new Money({
            amount: "0.03",
            asset: quoteAsset,
          }),
        }),
      ],
    }),
  })
  return applyBuyFill({
    state: afterSecondFill,
    fill: makeBuyFill({
      tradeId: "buy-fill-3",
      price: "0.08",
      quantity: "25",
      quoteQuantity: "2",
    }),
  })
}

function assertCompletedBuyAccounting({ state } = {}) {
  const position = state.portfolio.getPosition({ marketId: market.id })
  assert.equal(position.baseQuantity.amount, "174.85",
    "The completed BUY must aggregate every gross fill less all actual base commissions.")
  assert.equal(position.spent.amount, "18.066",
    "The completed BUY cost must aggregate every quote notional and all valued commissions exactly.")
  assert.equal(position.quoteNetCashFlow.amount, "-18.066",
    "The cumulative BUY quote cash flow must reconcile to the complete spent basis.")
  assert.equal(state.recoveryLedger.buyCost, "18.066",
    "The RecoveryLedger BUY cost must equal the cumulative Position spent basis.")
  assert.deepEqual(state.portfolio.appliedFillIds, [
    "binance:DOGEUSDT:buy-fill-1",
    "binance:DOGEUSDT:buy-fill-2",
    "binance:DOGEUSDT:buy-fill-3",
  ], "Portfolio must retain each distinct canonical execution identity.")
  assert.deepEqual(state.recoveryLedger.appliedFillIds, [
    "binance:DOGEUSDT:buy-fill-1",
    "binance:DOGEUSDT:buy-fill-2",
    "binance:DOGEUSDT:buy-fill-3",
  ], "RecoveryLedger must retain the same canonical BUY execution identities.")
}

function assertRejectedBuyPreservesAccounting({ state, rejected } = {}) {
  assert.equal(rejected.ok, false,
    "A BUY with an unvalued third-asset commission must fail closed.")
  assert.equal(rejected.data, undefined,
    "A rejected BUY must not return partially updated accounting projections.")
  assert.equal(state.portfolio.getPosition({ marketId: market.id }).value.baseQuantity.amount,
    "100", "Rejecting incomplete commission evidence must preserve accepted Position inventory.")
  assert.deepEqual(state.portfolio.appliedFillIds, ["binance:DOGEUSDT:accepted-buy"],
    "Rejecting incomplete commission evidence must not record its Fill ID in Portfolio.")
  assert.deepEqual(state.recoveryLedger.appliedFillIds, ["binance:DOGEUSDT:accepted-buy"],
    "Rejecting incomplete commission evidence must not record its Fill ID in RecoveryLedger.")
  assert.equal(state.recoveryLedger.buyCost, "10",
    "Rejecting incomplete commission evidence must preserve the accepted recovery cost.")
}

test("reconciles multiple BUY fills and every commission asset into one exact Position and recovery basis", () => {
  const firstBuyState = createFirstBuyState()
  assertFirstBuyAccounting({ state: firstBuyState })
  const completedBuyState = createCompletedBuyState({ state: firstBuyState })
  assertCompletedBuyAccounting({ state: completedBuyState })
})

test("rejects a later BUY with an unvalued third-asset commission without changing accepted accounting", () => {
  const state = applyBuyFill({
    state: {
      portfolio: new Portfolio(),
      recoveryLedger: RecoveryLedger.empty({ market }),
    },
    fill: makeBuyFill({
      tradeId: "accepted-buy",
      price: "0.1",
      quantity: "100",
      quoteQuantity: "10",
    }),
  })
  const rejected = updateTradingAccounting({
    portfolio: state.portfolio,
    recoveryLedger: state.recoveryLedger,
    fill: makeBuyFill({
      tradeId: "unvalued-third-fee-buy",
      price: "0.12",
      quantity: "50",
      quoteQuantity: "6",
      commissions: [
        new Commission({
          amount: new Money({
            amount: "0.001",
            asset: thirdAsset,
          }),
        }),
      ],
    }),
  })
  assertRejectedBuyPreservesAccounting({
    state,
    rejected,
  })
})
