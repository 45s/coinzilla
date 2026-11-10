import nodeTest from "node:test"
const test = (name, ...args) => nodeTest("[recovery-ledger.test.js] " + name, ...args)
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

test("rejects a reused Fill ID when commission asset differs without mutating RecoveryLedger", () => {
  const acceptedFill = makeFill({
    tradeId: "commission-asset-conflict",
    commissions: [
      new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) }),
    ],
  })
  const ledger = RecoveryLedger.empty({ market }).applyFill({ fill: acceptedFill }).ledger
  const originalState = ledger.value
  const conflictingFill = makeFill({
    tradeId: "commission-asset-conflict",
    commissions: [
      new Commission({ amount: new Money({ amount: "0.01", asset: baseAsset }) }),
    ],
  })

  assert.throws(
    () => ledger.applyFill({ fill: conflictingFill }),
    /Conflicting execution facts reused Fill ID/,
    "A reused execution identity with a different commission asset must be rejected.",
  )
  assert.deepEqual(
    ledger.value,
    originalState,
    "Rejecting conflicting commission facts must leave the complete accepted RecoveryLedger projection unchanged.",
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
  const reset = withSell.resetCycle({ minProfit: "0.01", spent: new Money({ amount: "10", asset: quoteAsset }) })

  assert.equal(reset.buyCost, "0")
  assert.equal(reset.netSellProceeds, "0")
  assert.equal("maxObservedCommissionRate" in reset.value, false)
  assert.equal(reset.appliedFillIds.length, 2)
  assert.equal(
    reset.applyFill({ fill: makeFill({ tradeId: "buy-before-reset" }) }).duplicate,
    true,
  )
})



test("requires an explicit minimum profit before resetting a recovery cycle", () => {
  const ledger = new RecoveryLedger({
    market,
    buyCost: "10",
    netSellProceeds: "11",
  })
  const originalState = ledger.value

  assert.throws(
    () => ledger.resetCycle({ spent: new Money({ amount: "10", asset: quoteAsset }) }),
    /minProfit/i,
    "A recovery cycle must not be reset without the strategy's explicit minimum-profit threshold.",
  )
  assert.deepEqual(ledger.value, originalState, "Rejecting a reset without its completion threshold must preserve the complete ledger.")
})

test("does not reset a recovered cycle before the configured minimum profit is reached", () => {
  const ledger = new RecoveryLedger({
    market,
    buyCost: "10",
    netSellProceeds: "10.005",
  })
  const originalState = ledger.value

  assert.throws(
    () => ledger.resetCycle({ minProfit: "0.01", spent: new Money({ amount: "10", asset: quoteAsset }) }),
    /minimum profit/i,
    "Recovering invested capital is not enough when realized profit is below the configured minimum.",
  )
  assert.deepEqual(ledger.value, originalState, "Rejecting a below-threshold reset must preserve cycle cost and proceeds.")
})

test("does not reset a recovery cycle while invested quote capital remains outstanding", () => {
  const ledger = new RecoveryLedger({
    market,
    buyCost: "10",
    netSellProceeds: "9",
  })
  const originalState = ledger.value

  assert.throws(
    () => ledger.resetCycle({ minProfit: "0.01", spent: new Money({ amount: "10", asset: quoteAsset }) }),
    /minimum profit/i,
    "A cycle with unrecovered invested capital must never be reset.",
  )
  assert.deepEqual(ledger.value, originalState, "Rejecting an unrecovered cycle reset must preserve the complete ledger.")
})


test("requires authoritative Position.spent in the matching quote asset before reset", () => {
  const ledger = new RecoveryLedger({
    market,
    buyCost: "10",
    netSellProceeds: "11",
  })
  const originalState = ledger.value

  assert.throws(
    () => ledger.resetCycle({ minProfit: "0.01" }),
    /Position\.spent/i,
    "A reset must receive the authoritative Position.spent Money value.",
  )
  assert.deepEqual(ledger.value, originalState, "Rejecting a reset without authoritative spent must preserve the complete ledger.")
})

test("rejects reset when authoritative Position.spent disagrees with the compatibility mirror", () => {
  const ledger = new RecoveryLedger({
    market,
    buyCost: "9",
    netSellProceeds: "11",
  })
  const originalState = ledger.value

  assert.throws(
    () => ledger.resetCycle({
      minProfit: "0.01",
      spent: new Money({ amount: "10", asset: quoteAsset }),
    }),
    /compatibility mirror/i,
    "The reset must detect divergence from authoritative Position.spent instead of calculating profit from the legacy buyCost mirror.",
  )
  assert.deepEqual(ledger.value, originalState, "Rejecting a mirror mismatch must preserve the complete ledger.")
})

test("rejects reset when authoritative Position.spent belongs to a different asset", () => {
  const ledger = new RecoveryLedger({
    market,
    buyCost: "10",
    netSellProceeds: "11",
  })
  const originalState = ledger.value

  assert.throws(
    () => ledger.resetCycle({
      minProfit: "0.01",
      spent: new Money({ amount: "10", asset: baseAsset }),
    }),
    /quote asset/i,
    "Recovery cost basis must be denominated in the market's canonical quote asset.",
  )
  assert.deepEqual(ledger.value, originalState, "Rejecting a mismatched spent asset must preserve the complete ledger.")
})

test("deduplicates equivalent REST and WebSocket fills in either delivery order", () => {
  const restDelivery = makeFill({
    tradeId: "binance-trade-10259",
    quantity: "4.995",
    quoteQuantity: "9.08",
  })
  const websocketDelivery = makeFill({
    tradeId: "binance-trade-10259",
    quantity: "4.995",
    quoteQuantity: "9.08",
  })

  const restThenWebsocket = RecoveryLedger.empty({ market })
    .applyFill({ fill: restDelivery }).ledger
  const duplicateWebsocket = restThenWebsocket.applyFill({ fill: websocketDelivery })
  assert.equal(duplicateWebsocket.applied, false)
  assert.equal(duplicateWebsocket.duplicate, true)
  assert.equal(duplicateWebsocket.ledger.buyCost, restThenWebsocket.buyCost)

  const websocketThenRest = RecoveryLedger.empty({ market })
    .applyFill({ fill: websocketDelivery }).ledger
  const duplicateRest = websocketThenRest.applyFill({ fill: restDelivery })
  assert.equal(duplicateRest.applied, false)
  assert.equal(duplicateRest.duplicate, true)
  assert.equal(duplicateRest.ledger.buyCost, websocketThenRest.buyCost)
})
