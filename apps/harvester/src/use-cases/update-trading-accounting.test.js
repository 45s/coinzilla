import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
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
} = {}) {
  return new Fill({
    tradeId,
    brokerOrderId: "order-" + tradeId,
    market,
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
