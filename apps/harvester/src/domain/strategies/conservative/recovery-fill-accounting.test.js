import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { calculateRecoveryFillAccounting } from "./recovery-fill-accounting.js"

const baseAsset = new Asset({ id: "asset:DOGE", code: "DOGE" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const thirdAsset = new Asset({ id: "asset:BNB", code: "BNB" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })

function makeFill({
  side = "BUY",
  quoteQuantity = "10",
  commissions = [],
  commissionStatus = "COMPLETE",
} = {}) {
  return new Fill({
    tradeId: "trade-1",
    brokerOrderId: "order-1",
    market,
    side,
    price: new Money({ amount: "0.1", asset: quoteAsset }),
    quantity: new Quantity({ amount: "100", asset: baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
    commissions,
    commissionStatus,
  })
}

test("adds actual quote commission to BUY recovery cost", () => {
  const fill = makeFill({
    commissions: [
      new Commission({ amount: new Money({ amount: "0.02", asset: quoteAsset }) }),
    ],
  })
  assert.deepEqual(calculateRecoveryFillAccounting({ market, fill }), {
    buyCost: "10.02",
    netSellProceeds: "0",
  })
})

test("does not convert base BUY commission into quote recovery cost", () => {
  const fill = makeFill({
    commissions: [
      new Commission({ amount: new Money({ amount: "0.1", asset: baseAsset }) }),
    ],
  })
  assert.deepEqual(calculateRecoveryFillAccounting({ market, fill }), {
    buyCost: "10",
    netSellProceeds: "0",
  })
})

test("credits SELL proceeds net of actual quote commission", () => {
  const fill = makeFill({
    side: "SELL",
    quoteQuantity: "12",
    commissions: [
      new Commission({ amount: new Money({ amount: "0.03", asset: quoteAsset }) }),
    ],
  })
  assert.deepEqual(calculateRecoveryFillAccounting({ market, fill }), {
    buyCost: "0",
    netSellProceeds: "11.97",
  })
})

test("does not deduct base SELL commission from quote recovery proceeds", () => {
  const fill = makeFill({
    side: "SELL",
    quoteQuantity: "12",
    commissions: [
      new Commission({ amount: new Money({ amount: "0.1", asset: baseAsset }) }),
    ],
  })
  assert.deepEqual(calculateRecoveryFillAccounting({ market, fill }), {
    buyCost: "0",
    netSellProceeds: "12",
  })
})

test("rejects incomplete commission data and third-asset fees", () => {
  assert.throws(
    () => calculateRecoveryFillAccounting({
      market,
      fill: makeFill({ commissionStatus: "UNKNOWN" }),
    }),
    /complete commission data/,
  )
  assert.throws(
    () => calculateRecoveryFillAccounting({
      market,
      fill: makeFill({
        commissions: [
          new Commission({ amount: new Money({ amount: "0.01", asset: thirdAsset }) }),
        ],
      }),
    }),
    /third-asset commission/,
  )
})

test("rejects quote commission greater than SELL proceeds", () => {
  assert.throws(
    () => calculateRecoveryFillAccounting({
      market,
      fill: makeFill({
        side: "SELL",
        quoteQuantity: "0.01",
        commissions: [
          new Commission({ amount: new Money({ amount: "0.02", asset: quoteAsset }) }),
        ],
      }),
    }),
    /exceeds SELL quote proceeds/,
  )
})
