import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { RecoveryLedger } from "./recovery-ledger.js"

const baseAsset = new Asset({ id: "asset:DOGE", code: "DOGE" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })

function makeFill({
  tradeId,
  side = "BUY",
  quantity = "100",
  quoteQuantity = "10",
  commissions = [],
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
    commissionStatus: "COMPLETE",
  })
}

test("accumulates BUY costs and confirmed net SELL proceeds across replacement orders", () => {
  const bought = RecoveryLedger.empty({ market }).applyFill({
    fill: makeFill({
      tradeId: "buy-1",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.02", asset: quoteAsset }) }),
      ],
    }),
  }).ledger

  const firstPartialSell = bought.applyFill({
    fill: makeFill({
      tradeId: "sell-1",
      side: "SELL",
      quantity: "40",
      quoteQuantity: "4.5",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) }),
      ],
    }),
  }).ledger

  // Cancellation/replacement itself does not reset or alter the ledger.
  const afterReplacement = firstPartialSell.applyFill({
    fill: makeFill({
      tradeId: "sell-2",
      side: "SELL",
      quantity: "59",
      quoteQuantity: "6",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) }),
      ],
    }),
  }).ledger

  assert.equal(afterReplacement.buyCost, "10.02")
  assert.equal(afterReplacement.netSellProceeds, "10.48")
  assert.equal(afterReplacement.outstandingRecoveryAmount, "0")
  assert.equal(afterReplacement.realizedNetProfit, "0.46")
  assert.equal(afterReplacement.appliedFillIds.length, 3)
})

test("deduplicates the same canonical fill without changing recovery accounting", () => {
  const ledger = RecoveryLedger.empty({ market }).applyFill({
    fill: makeFill({ tradeId: "buy-1" }),
  }).ledger
  const duplicate = ledger.applyFill({ fill: makeFill({ tradeId: "buy-1" }) })

  assert.equal(duplicate.applied, false)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.ledger, ledger)
})

test("rejects fills for another market", () => {
  const otherBase = new Asset({ id: "asset:ETH", code: "ETH" })
  const otherMarket = new Market({ venue: "binance", symbol: "ETHUSDT", baseAsset: otherBase, quoteAsset })
  const otherFill = new Fill({
    tradeId: "eth-buy",
    brokerOrderId: "eth-order",
    market: otherMarket,
    side: "BUY",
    price: new Money({ amount: "10", asset: quoteAsset }),
    quantity: new Quantity({ amount: "1", asset: otherBase }),
    quoteQuantity: new Money({ amount: "10", asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })

  assert.throws(
    () => RecoveryLedger.empty({ market }).applyFill({ fill: otherFill }),
    /does not match/,
  )
})

test("rejects a reused Fill ID when recovery execution facts differ", () => {
  const ledger = RecoveryLedger.empty({ market }).applyFill({
    fill: makeFill({ tradeId: "reused-trade", quantity: "100", quoteQuantity: "10" }),
  }).ledger

  assert.throws(
    () => ledger.applyFill({
      fill: makeFill({ tradeId: "reused-trade", quantity: "99", quoteQuantity: "9.9" }),
    }),
    /Conflicting execution facts reused Fill ID/,
  )
})

test("resets cycle totals while preserving fill identities for deduplication", () => {
  const withBuy = RecoveryLedger.empty({ market }).applyFill({
    fill: makeFill({ tradeId: "buy-before-reset" }),
  }).ledger
  const withSell = withBuy.applyFill({
    fill: makeFill({
      tradeId: "sell-before-reset",
      side: "SELL",
      quantity: "100",
      quoteQuantity: "11",
    }),
  }).ledger
  const reset = withSell.resetCycle()

  assert.equal(reset.buyCost, "0")
  assert.equal(reset.netSellProceeds, "0")
  assert.equal("maxObservedCommissionRate" in reset.value, false)
  assert.equal(reset.appliedFillIds.length, 2)
  assert.equal(
    reset.applyFill({ fill: makeFill({ tradeId: "buy-before-reset" }) }).duplicate,
    true,
  )
})
