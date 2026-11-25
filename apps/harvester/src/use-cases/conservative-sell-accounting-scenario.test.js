import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { updateTradingAccounting } from "./update-trading-accounting.js"
import { evaluateRecoveryCompletion } from "../domain/strategies/conservative/recovery-completion.js"

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

function makeCommission({ amount, asset, quoteValue } = {}) {
  return new Commission({
    amount: new Money({
      amount,
      asset,
    }),
    ...(quoteValue === undefined
      ? {}
      : {
        quoteValue: new Money({
          amount: quoteValue,
          asset: quoteAsset,
        }),
      }),
  })
}

function makeFill({
  tradeId,
  side,
  price,
  quantity,
  quoteQuantity,
  commissions = [],
} = {}) {
  return new Fill({
    tradeId,
    brokerOrderId: `${side.toLowerCase()}-order-${tradeId}`,
    market,
    side,
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

function applyFill({ state, fill } = {}) {
  const result = updateTradingAccounting({
    portfolio: state.portfolio,
    recoveryLedger: state.recoveryLedger,
    fill,
  })
  assert.equal(
    result.ok,
    true,
    `A valid canonical ${fill.side} Fill ${fill.tradeId} must update both accounting projections.`,
  )
  assert.equal(
    result.data.applied,
    true,
    `The distinct ${fill.side} Fill ${fill.tradeId} must be applied exactly once.`,
  )
  return {
    portfolio: result.data.portfolio,
    recoveryLedger: result.data.recoveryLedger,
  }
}

function createInitialBuyState() {
  return applyFill({
    state: {
      portfolio: new Portfolio(),
      recoveryLedger: RecoveryLedger.empty({ market }),
    },
    fill: makeFill({
      tradeId: "buy-fill",
      side: "BUY",
      price: "0.1",
      quantity: "100",
      quoteQuantity: "10",
      commissions: [
        makeCommission({
          amount: "0.1",
          asset: baseAsset,
        }),
        makeCommission({
          amount: "0.01",
          asset: quoteAsset,
        }),
        makeCommission({
          amount: "0.001",
          asset: thirdAsset,
          quoteValue: "0.02",
        }),
      ],
    }),
  })
}

function createPartiallySoldState() {
  const bought = createInitialBuyState()
  return applyFill({
    state: bought,
    fill: makeFill({
      tradeId: "sell-fill-1",
      side: "SELL",
      price: "0.13",
      quantity: "40",
      quoteQuantity: "5.2",
      commissions: [
        makeCommission({
          amount: "0.04",
          asset: baseAsset,
        }),
        makeCommission({
          amount: "0.005",
          asset: quoteAsset,
        }),
        makeCommission({
          amount: "0.001",
          asset: thirdAsset,
          quoteValue: "0.015",
        }),
      ],
    }),
  })
}

function createCompletedSellState() {
  const afterFirstSell = createPartiallySoldState()
  const afterSecondSell = applyFill({
    state: afterFirstSell,
    fill: makeFill({
      tradeId: "sell-fill-2",
      side: "SELL",
      price: "0.15",
      quantity: "30",
      quoteQuantity: "4.5",
      commissions: [
        makeCommission({
          amount: "0.03",
          asset: baseAsset,
        }),
        makeCommission({
          amount: "0.01",
          asset: quoteAsset,
        }),
      ],
    }),
  })
  return applyFill({
    state: afterSecondSell,
    fill: makeFill({
      tradeId: "sell-fill-3",
      side: "SELL",
      price: "0.15",
      quantity: "29.8",
      quoteQuantity: "4.47",
      commissions: [
        makeCommission({
          amount: "0.03",
          asset: baseAsset,
        }),
        makeCommission({
          amount: "0.001",
          asset: thirdAsset,
          quoteValue: "0.02",
        }),
      ],
    }),
  })
}

function assertPartiallySoldAccounting({ state } = {}) {
  const position = state.portfolio.getPosition({ marketId: market.id })
  assert.equal(
    position.baseQuantity.amount,
    "59.86",
    "The first SELL must debit 40 gross DOGE plus its actual 0.04 DOGE commission.",
  )
  assert.equal(
    position.spent.amount,
    "10.03",
    "SELL fills must preserve the complete original BUY cost basis.",
  )
  assert.equal(
    position.quoteNetCashFlow.amount,
    "-4.85",
    "The first SELL must add 5.18 net USDT after both quote and valued third-asset fees to the original -10.03 USDT cash flow.",
  )
  assert.equal(
    state.recoveryLedger.buyCost,
    "10.03",
    "The recovery cost mirror must remain equal to the full Position spent basis after a partial SELL.",
  )
  assert.equal(
    state.recoveryLedger.netSellProceeds,
    "5.18",
    "The RecoveryLedger must record 5.2 gross proceeds less 0.005 USDT and 0.015 USDT-equivalent fees.",
  )
  assert.equal(
    state.recoveryLedger.outstandingRecoveryAmount,
    "4.85",
    "Outstanding recovery must equal the full BUY basis less confirmed net SELL proceeds.",
  )
}

function assertCompletedSellAccounting({ state } = {}) {
  const position = state.portfolio.getPosition({ marketId: market.id })
  assert.equal(
    position.baseQuantity.amount,
    "0",
    "All 99.9 net DOGE from the BUY must be debited across the three SELL fills and their base commissions.",
  )
  assert.equal(
    position.spent.amount,
    "10.03",
    "Completing SELL accounting must not erase or prorate the original BUY cost basis.",
  )
  assert.equal(
    position.quoteNetCashFlow.amount,
    "4.09",
    "Portfolio net quote cash flow must reconcile to 14.12 net SELL proceeds less 10.03 BUY cost.",
  )
  assert.equal(
    state.recoveryLedger.buyCost,
    "10.03",
    "RecoveryLedger buyCost must continue to mirror the authoritative Position spent amount.",
  )
  assert.equal(
    state.recoveryLedger.netSellProceeds,
    "14.12",
    "RecoveryLedger proceeds must aggregate all three SELL fills after actual base, quote and valued third-asset commission treatment.",
  )
  assert.equal(
    state.recoveryLedger.outstandingRecoveryAmount,
    "0",
    "No quote recovery amount remains after confirmed net SELL proceeds exceed the original BUY cost.",
  )
  assert.equal(
    state.recoveryLedger.realizedNetProfit,
    "4.09",
    "Realized net profit must equal 14.12 net proceeds less the full 10.03 BUY cost.",
  )
  assert.deepEqual(
    state.portfolio.appliedFillIds,
    [
      "binance:DOGEUSDT:buy-fill",
      "binance:DOGEUSDT:sell-fill-1",
      "binance:DOGEUSDT:sell-fill-2",
      "binance:DOGEUSDT:sell-fill-3",
    ],
    "Portfolio must retain each canonical BUY and SELL execution identity exactly once.",
  )
  assert.deepEqual(
    state.recoveryLedger.appliedFillIds,
    [
      "binance:DOGEUSDT:buy-fill",
      "binance:DOGEUSDT:sell-fill-1",
      "binance:DOGEUSDT:sell-fill-2",
      "binance:DOGEUSDT:sell-fill-3",
    ],
    "RecoveryLedger must retain the same canonical BUY and SELL execution identities as Portfolio.",
  )
}

function assertAccountingStateUnchanged({ state, portfolioValue, ledgerValue } = {}) {
  assert.deepEqual(
    state.portfolio.value,
    portfolioValue,
    "A duplicate or rejected SELL must leave the accepted Portfolio projection unchanged.",
  )
  assert.deepEqual(
    state.recoveryLedger.value,
    ledgerValue,
    "A duplicate or rejected SELL must leave the accepted RecoveryLedger projection unchanged.",
  )
}

test("reconciles partial, multiple and final SELL fills across Position and RecoveryLedger", () => {
  const partiallySold = createPartiallySoldState()
  assertPartiallySoldAccounting({ state: partiallySold })

  const completed = createCompletedSellState()
  assertCompletedSellAccounting({ state: completed })
})

function createFinalSellFill({
  thirdAssetCommissionAmount = "0.001",
  thirdAssetQuoteValue = "0.02",
} = {}) {
  return makeFill({
    tradeId: "sell-fill-3",
    side: "SELL",
    price: "0.15",
    quantity: "29.8",
    quoteQuantity: "4.47",
    commissions: [
      makeCommission({
        amount: "0.03",
        asset: baseAsset,
      }),
      makeCommission({
        amount: thirdAssetCommissionAmount,
        asset: thirdAsset,
        quoteValue: thirdAssetQuoteValue,
      }),
    ],
  })
}

test("treats an identical repeated SELL execution as a no-op in both projections", () => {
  const state = createCompletedSellState()
  const portfolioValue = state.portfolio.value
  const ledgerValue = state.recoveryLedger.value
  const duplicate = updateTradingAccounting({
    portfolio: state.portfolio,
    recoveryLedger: state.recoveryLedger,
    fill: createFinalSellFill(),
  })

  assert.equal(duplicate.ok, true, "An identical repeated SELL execution must be accepted as a harmless duplicate.")
  assert.equal(duplicate.data.applied, false, "A duplicate SELL must not be applied a second time.")
  assert.equal(duplicate.data.duplicate, true, "A repeated SELL must be classified as duplicate.")
  assert.strictEqual(duplicate.data.portfolio, state.portfolio)
  assert.strictEqual(duplicate.data.recoveryLedger, state.recoveryLedger)
  assertAccountingStateUnchanged({
    state,
    portfolioValue,
    ledgerValue,
  })
})

test("rejects changed SELL commission facts without mutating either projection", () => {
  const state = createCompletedSellState()
  const portfolioValue = state.portfolio.value
  const ledgerValue = state.recoveryLedger.value
  const rejected = updateTradingAccounting({
    portfolio: state.portfolio,
    recoveryLedger: state.recoveryLedger,
    fill: createFinalSellFill({
      thirdAssetCommissionAmount: "0.002",
    }),
  })

  assert.equal(rejected.ok, false, "Changed commission facts under an accepted SELL identity must fail closed.")
  assert.match(
    rejected.errors[0].message,
    /Conflicting execution facts reused Fill ID/,
    "The rejection must identify conflicting canonical SELL execution evidence.",
  )
  assert.equal(rejected.data, undefined, "A conflicting SELL must not return a partial accounting projection.")
  assertAccountingStateUnchanged({
    state,
    portfolioValue,
    ledgerValue,
  })
})

test("rejects an unvalued third-asset SELL commission without partially committing either projection", () => {
  const state = createPartiallySoldState()
  const portfolioValue = state.portfolio.value
  const ledgerValue = state.recoveryLedger.value
  const invalidSell = makeFill({
    tradeId: "sell-with-unvalued-fee",
    side: "SELL",
    price: "0.15",
    quantity: "10",
    quoteQuantity: "1.5",
    commissions: [
      makeCommission({
        amount: "0.001",
        asset: thirdAsset,
      }),
    ],
  })
  const rejected = updateTradingAccounting({
    portfolio: state.portfolio,
    recoveryLedger: state.recoveryLedger,
    fill: invalidSell,
  })

  assert.equal(rejected.ok, false, "A SELL with an unvalued third-asset commission must fail closed.")
  assert.match(
    rejected.errors[0].message,
    /reliable quote-currency valuation/,
    "The failure must identify the missing third-asset quote valuation.",
  )
  assert.equal(rejected.data, undefined, "A rejected SELL must not return a partially updated accounting projection.")
  assertAccountingStateUnchanged({
    state,
    portfolioValue,
    ledgerValue,
  })
})

test("completes accounting-backed recovery while retaining validated constrained dust", () => {
  const bought = createInitialBuyState()
  const sold = applyFill({
    state: bought,
    fill: makeFill({
      tradeId: "sell-with-constrained-dust",
      side: "SELL",
      price: "0.1023",
      quantity: "99.7",
      quoteQuantity: "10.2",
      commissions: [
        makeCommission({
          amount: "0.01",
          asset: quoteAsset,
        }),
      ],
    }),
  })
  const position = sold.portfolio.getPosition({ marketId: market.id })
  const completion = evaluateRecoveryCompletion({
    sellOrderFullyFilled: true,
    spent: sold.recoveryLedger.buyCost,
    netSellProceeds: sold.recoveryLedger.netSellProceeds,
    activeQuantity: position.baseQuantity.amount,
    keepQuantity: "0.1",
    minProfit: "0.01",
    inventoryDisposition: {
      status: "EXCHANGE_CONSTRAINED_DUST",
      quantity: "0.1",
      reason: "QUANTITY_INCREMENT",
      quantityStepSize: "0.2",
      evaluatedQuantity: "0.1",
    },
  })

  assert.equal(position.baseQuantity.amount, "0.2", "Confirmed SELL accounting must leave the exact residual inventory.")
  assert.equal(sold.recoveryLedger.buyCost, "10.03", "The full BUY cost basis must reach recovery completion unchanged.")
  assert.equal(sold.recoveryLedger.netSellProceeds, "10.19", "Completion must use confirmed net proceeds after the actual quote fee.")
  assert.deepEqual(completion, {
    eligible: true,
    pause: false,
    reason: null,
    freeQuantity: "0.2",
    realizedNetProfit: "0.16",
    dust: {
      status: "EXCHANGE_CONSTRAINED_DUST",
      quantity: "0.1",
      reason: "QUANTITY_INCREMENT",
      quantityStepSize: "0.2",
      evaluatedQuantity: "0.1",
    },
  }, "The cycle must retain keepQuantity plus only the exact exchange-constrained dust bonus.")
})
