import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { evaluateRecoveryCompletion } from "../domain/strategies/conservative/recovery-completion.js"
import { updateTradingAccounting } from "./update-trading-accounting.js"

const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({
  venue: "binance",
  symbol: "DOGEUSDT",
  baseAsset,
  quoteAsset,
})

function makeFill({
  tradeId = "trade-1",
  side = "BUY",
  quantity = "100",
  quoteQuantity = "10",
  commissions = [],
  commissionStatus = "COMPLETE",
  fillMarket = market,
} = {}) {
  return new Fill({
    tradeId,
    brokerOrderId: "order-" + tradeId,
    market: fillMarket,
    side,
    price: new Money({ amount: "0.1", asset: quoteAsset }),
    quantity: new Quantity({ amount: quantity, asset: baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
    commissions,
    commissionStatus,
  })
}

test("applies a canonical BUY fill to Portfolio and RecoveryLedger together", () => {
  const portfolio = new Portfolio()
  const recoveryLedger = RecoveryLedger.empty({ market })
  const result = updateTradingAccounting({
    portfolio,
    recoveryLedger,
    fill: makeFill({
      commissions: [
        new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) }),
      ],
    }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.applied, true)
  assert.equal(result.data.portfolio.getPosition({ marketId: market.id }).baseQuantity.amount, "100")
  assert.equal(result.data.recoveryLedger.buyCost, "10.01")
  assert.equal(portfolio.positions.length, 0)
  assert.equal(recoveryLedger.buyCost, "0")
})

test("applies SELL proceeds net of actual quote commission to the recovery ledger", () => {
  const initial = updateTradingAccounting({
    portfolio: new Portfolio(),
    recoveryLedger: RecoveryLedger.empty({ market }),
    fill: makeFill(),
  }).data
  const result = updateTradingAccounting({
    portfolio: initial.portfolio,
    recoveryLedger: initial.recoveryLedger,
    fill: makeFill({
      tradeId: "sell-1",
      side: "SELL",
      quantity: "50",
      quoteQuantity: "5.5",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) }),
      ],
    }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.recoveryLedger.netSellProceeds, "5.49")
  assert.equal(result.data.recoveryLedger.outstandingRecoveryAmount, "4.51")
  assert.equal(result.data.portfolio.getPosition({ marketId: market.id }).baseQuantity.amount, "50")
})

test("applies identical duplicate fills idempotently to both projections", () => {
  const fill = makeFill()
  const first = updateTradingAccounting({
    portfolio: new Portfolio(),
    recoveryLedger: RecoveryLedger.empty({ market }),
    fill,
  })
  const duplicate = updateTradingAccounting({
    portfolio: first.data.portfolio,
    recoveryLedger: first.data.recoveryLedger,
    fill,
  })

  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.data.applied, false)
  assert.equal(duplicate.data.duplicate, true)
  assert.equal(duplicate.data.portfolio, first.data.portfolio)
  assert.equal(duplicate.data.recoveryLedger, first.data.recoveryLedger)
})

test("rejects unsupported third-asset fees without returning partially updated projections", () => {
  const thirdAsset = new Asset({ id: "bnb", code: "BNB" })
  const fill = makeFill({
    commissions: [
      new Commission({ amount: new Money({ amount: "0.001", asset: thirdAsset }) }),
    ],
  })
  const portfolio = new Portfolio()
  const recoveryLedger = RecoveryLedger.empty({ market })
  const result = updateTradingAccounting({ portfolio, recoveryLedger, fill })

  assert.equal(result.ok, false)
  assert.equal(portfolio.positions.length, 0)
  assert.equal(recoveryLedger.buyCost, "0")
})

test("rejects invalid application inputs", () => {
  assert.equal(updateTradingAccounting({
    portfolio: {},
    recoveryLedger: RecoveryLedger.empty({ market }),
    fill: makeFill(),
  }).ok, false)
  assert.equal(updateTradingAccounting({
    portfolio: new Portfolio(),
    recoveryLedger: {},
    fill: makeFill(),
  }).ok, false)
  assert.equal(updateTradingAccounting({
    portfolio: new Portfolio(),
    recoveryLedger: RecoveryLedger.empty({ market }),
    fill: {},
  }).ok, false)
})


test("rejects a wrong-market fill atomically when Portfolio accepts but RecoveryLedger rejects", () => {
  const otherMarket = new Market({
    venue: "binance",
    symbol: "DOGEUSDC",
    baseAsset,
    quoteAsset,
  })
  const portfolio = new Portfolio()
  const recoveryLedger = RecoveryLedger.empty({ market })
  const fill = makeFill({ fillMarket: otherMarket })

  assert.equal(portfolio.applyFill({ fill }).applied, true)
  const result = updateTradingAccounting({ portfolio, recoveryLedger, fill })

  assert.equal(result.ok, false)
  assert.equal(portfolio.positions.length, 0)
  assert.equal(recoveryLedger.buyCost, "0")
  assert.deepEqual(recoveryLedger.appliedFillIds, [])
})


test("accounts base and quote commissions atomically across Portfolio and RecoveryLedger", () => {
  const buy = makeFill({
    tradeId: "buy-base-and-quote-fees",
    commissions: [
      new Commission({ amount: new Money({ amount: "1", asset: baseAsset }) }),
      new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) }),
    ],
  })
  const bought = updateTradingAccounting({
    portfolio: new Portfolio(),
    recoveryLedger: RecoveryLedger.empty({ market }),
    fill: buy,
  })

  assert.equal(bought.ok, true)
  const positionAfterBuy = bought.data.portfolio.getPosition({ marketId: market.id })
  assert.equal(positionAfterBuy.baseQuantity.amount, "99")
  assert.equal(positionAfterBuy.quoteNetCashFlow.amount, "-10.01")
  assert.equal(bought.data.recoveryLedger.buyCost, "10.01")

  const sell = makeFill({
    tradeId: "sell-base-and-quote-fees",
    side: "SELL",
    quantity: "50",
    quoteQuantity: "6",
    commissions: [
      new Commission({ amount: new Money({ amount: "0.5", asset: baseAsset }) }),
      new Commission({ amount: new Money({ amount: "0.02", asset: quoteAsset }) }),
    ],
  })
  const sold = updateTradingAccounting({
    portfolio: bought.data.portfolio,
    recoveryLedger: bought.data.recoveryLedger,
    fill: sell,
  })

  assert.equal(sold.ok, true)
  const positionAfterSell = sold.data.portfolio.getPosition({ marketId: market.id })
  assert.equal(positionAfterSell.baseQuantity.amount, "48.5")
  assert.equal(positionAfterSell.quoteNetCashFlow.amount, "-4.03")
  assert.equal(sold.data.recoveryLedger.buyCost, "10.01")
  assert.equal(sold.data.recoveryLedger.netSellProceeds, "5.98")
})

test("reconciles multiple commission-bearing fills exactly across Portfolio and RecoveryLedger", () => {
  const fills = [
    makeFill({
      tradeId: "cycle-buy-1",
      quantity: "100",
      quoteQuantity: "10",
      commissions: [
        new Commission({ amount: new Money({ amount: "1", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) }),
      ],
    }),
    makeFill({
      tradeId: "cycle-buy-2",
      quantity: "50",
      quoteQuantity: "5",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.5", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.005", asset: quoteAsset }) }),
      ],
    }),
    makeFill({
      tradeId: "cycle-sell-1",
      side: "SELL",
      quantity: "40",
      quoteQuantity: "4.4",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.4", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.004", asset: quoteAsset }) }),
      ],
    }),
    makeFill({
      tradeId: "cycle-sell-2",
      side: "SELL",
      quantity: "50",
      quoteQuantity: "5.5",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.5", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.005", asset: quoteAsset }) }),
      ],
    }),
  ]
  let portfolio = new Portfolio()
  let recoveryLedger = RecoveryLedger.empty({ market })

  for (const fill of fills) {
    const result = updateTradingAccounting({ portfolio, recoveryLedger, fill })
    assert.equal(result.ok, true, result.errors?.[0]?.message)
    assert.equal(result.data.applied, true)
    portfolio = result.data.portfolio
    recoveryLedger = result.data.recoveryLedger
  }

  const position = portfolio.getPosition({ marketId: market.id })
  assert.equal(position.baseQuantity.amount, "57.6")
  assert.equal(position.quoteNetCashFlow.amount, "-5.124")
  assert.equal(recoveryLedger.buyCost, "15.015")
  assert.equal(recoveryLedger.netSellProceeds, "9.891")
  assert.equal(recoveryLedger.outstandingRecoveryAmount, "5.124")
  assert.equal(
    position.quoteNetCashFlow.amount,
    "-" + recoveryLedger.outstandingRecoveryAmount,
  )
  assert.equal(portfolio.appliedFillIds.length, 4)
  assert.equal(recoveryLedger.appliedFillIds.length, 4)
})

test("reconciles fee-adjusted Portfolio cash flow with RecoveryLedger cycle profit", () => {
  const fills = [
    makeFill({
      tradeId: "cycle-proof-buy",
      quantity: "100",
      quoteQuantity: "10",
      commissions: [
        new Commission({ amount: new Money({ amount: "1", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) }),
      ],
    }),
    makeFill({
      tradeId: "cycle-proof-sell-1",
      side: "SELL",
      quantity: "48.5",
      quoteQuantity: "5.5",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.485", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) }),
      ],
    }),
    makeFill({
      tradeId: "cycle-proof-sell-2",
      side: "SELL",
      quantity: "48.5",
      quoteQuantity: "5.5",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.485", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) }),
      ],
    }),
  ]
  let portfolio = new Portfolio()
  let recoveryLedger = RecoveryLedger.empty({ market })

  for (const fill of fills) {
    const result = updateTradingAccounting({ portfolio, recoveryLedger, fill })
    assert.equal(result.ok, true, result.errors?.[0]?.message)
    portfolio = result.data.portfolio
    recoveryLedger = result.data.recoveryLedger
  }

  const position = portfolio.getPosition({ marketId: market.id })
  const completion = evaluateRecoveryCompletion({
    sellOrderFullyFilled: true,
    buyCost: recoveryLedger.buyCost,
    netSellProceeds: recoveryLedger.netSellProceeds,
    activeQuantity: position.baseQuantity.amount,
    keepQuantity: "1",
    minProfit: "0.01",
  })

  assert.equal(position.baseQuantity.amount, "1.03")
  assert.equal(position.quoteNetCashFlow.amount, "0.97")
  assert.equal(recoveryLedger.buyCost, "10.01")
  assert.equal(recoveryLedger.netSellProceeds, "10.98")
  assert.equal(completion.eligible, false)
  assert.equal(completion.pause, false)
  assert.equal(completion.reason, "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH")
  assert.equal(completion.freeQuantity, "0")
  assert.equal(completion.realizedNetProfit, "0.97")
  assert.equal(position.quoteNetCashFlow.amount, completion.realizedNetProfit)
})

test("rejects unknown commission status without committing either accounting projection", () => {
  const portfolio = new Portfolio()
  const recoveryLedger = RecoveryLedger.empty({ market })
  const result = updateTradingAccounting({
    portfolio,
    recoveryLedger,
    fill: makeFill({ commissionStatus: "UNKNOWN" }),
  })

  assert.equal(result.ok, false)
  assert.equal(portfolio.positions.length, 0)
  assert.deepEqual(portfolio.appliedFillIds, [])
  assert.equal(recoveryLedger.buyCost, "0")
  assert.equal(recoveryLedger.netSellProceeds, "0")
  assert.deepEqual(recoveryLedger.appliedFillIds, [])
})

test("rejects conflicting replayed execution facts without changing either projection", () => {
  const first = updateTradingAccounting({
    portfolio: new Portfolio(),
    recoveryLedger: RecoveryLedger.empty({ market }),
    fill: makeFill({ tradeId: "replayed-execution", quantity: "100", quoteQuantity: "10" }),
  })
  assert.equal(first.ok, true)

  const conflicting = updateTradingAccounting({
    portfolio: first.data.portfolio,
    recoveryLedger: first.data.recoveryLedger,
    fill: makeFill({ tradeId: "replayed-execution", quantity: "99", quoteQuantity: "9.9" }),
  })

  assert.equal(conflicting.ok, false)
  assert.equal(conflicting.data, undefined)
  assert.equal(first.data.portfolio.getPosition({ marketId: market.id }).baseQuantity.amount, "100")
  assert.equal(first.data.recoveryLedger.buyCost, "10")
  assert.deepEqual(first.data.portfolio.appliedFillIds, ["binance:DOGEUSDT:replayed-execution"])
  assert.deepEqual(first.data.recoveryLedger.appliedFillIds, ["binance:DOGEUSDT:replayed-execution"])
})


test("reconciles the two observed ZROUSDT TESTNET executions exactly and deduplicates replays", () => {
  const zroAsset = new Asset({ id: "zro", code: "ZRO" })
  const usdtAsset = new Asset({ id: "usdt-zro-test", code: "USDT" })
  const zroMarket = new Market({
    venue: "binance",
    symbol: "ZROUSDT",
    baseAsset: zroAsset,
    quoteAsset: usdtAsset,
  })
  const fills = [
    new Fill({
      tradeId: "9939",
      brokerOrderId: "698704",
      market: zroMarket,
      side: "BUY",
      price: new Money({ amount: "1.792", asset: usdtAsset }),
      quantity: new Quantity({ amount: "5", asset: zroAsset }),
      quoteQuantity: new Money({ amount: "8.96", asset: usdtAsset }),
      commissions: [new Commission({ amount: new Money({ amount: "0.005", asset: zroAsset }) })],
      commissionStatus: "COMPLETE",
    }),
    new Fill({
      tradeId: "9940",
      brokerOrderId: "698746",
      market: zroMarket,
      side: "BUY",
      price: new Money({ amount: "1.789", asset: usdtAsset }),
      quantity: new Quantity({ amount: "5", asset: zroAsset }),
      quoteQuantity: new Money({ amount: "8.945", asset: usdtAsset }),
      commissions: [new Commission({ amount: new Money({ amount: "0.005", asset: zroAsset }) })],
      commissionStatus: "COMPLETE",
    }),
  ]

  let portfolio = new Portfolio()
  let recoveryLedger = RecoveryLedger.empty({ market: zroMarket })
  for (const fill of fills) {
    const result = updateTradingAccounting({ portfolio, recoveryLedger, fill })
    assert.equal(result.ok, true, result.errors?.[0]?.message)
    assert.equal(result.data.applied, true)
    portfolio = result.data.portfolio
    recoveryLedger = result.data.recoveryLedger
  }

  const position = portfolio.getPosition({ marketId: zroMarket.id })
  assert.equal(position.baseQuantity.amount, "9.99")
  assert.equal(position.quoteNetCashFlow.amount, "-17.905")
  assert.equal(recoveryLedger.buyCost, "17.905")
  assert.equal(recoveryLedger.netSellProceeds, "0")
  assert.equal(recoveryLedger.outstandingRecoveryAmount, "17.905")
  assert.equal(portfolio.appliedFillIds.length, 2)
  assert.equal(recoveryLedger.appliedFillIds.length, 2)

  const duplicate = updateTradingAccounting({ portfolio, recoveryLedger, fill: fills[1] })
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.data.applied, false)
  assert.equal(duplicate.data.duplicate, true)
  assert.equal(duplicate.data.portfolio, portfolio)
  assert.equal(duplicate.data.recoveryLedger, recoveryLedger)
})
