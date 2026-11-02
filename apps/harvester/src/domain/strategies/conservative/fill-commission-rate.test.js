import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { calculateFillCommissionRate } from "./fill-commission-rate.js"

const baseAsset = new Asset({ id: "asset:BTC", code: "BTC" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const thirdAsset = new Asset({ id: "asset:BNB", code: "BNB" })
const market = new Market({ venue: "binance", symbol: "BTCUSDT", baseAsset, quoteAsset })

function makeFill({ market: fillMarket = market, commissions = [], commissionStatus = "COMPLETE" } = {}) {
  return new Fill({
    tradeId: "trade-1",
    brokerOrderId: "order-1",
    market: fillMarket,
    side: "BUY",
    price: new Money({ amount: "100", asset: quoteAsset }),
    quantity: new Quantity({ amount: "2", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "200", asset: quoteAsset }),
    commissions,
    commissionStatus,
  })
}

test("returns zero when a complete fill has no commission", () => {
  assert.deepEqual(
    calculateFillCommissionRate({ market, fill: makeFill() }),
    { rate: "0" },
  )
})

test("values quote-asset commission against executed quote notional", () => {
  const fill = makeFill({
    commissions: [
      new Commission({ amount: new Money({ amount: "0.2", asset: quoteAsset }) }),
    ],
  })
  assert.deepEqual(calculateFillCommissionRate({ market, fill }), { rate: "0.001" })
})

test("values base-asset commission at the actual fill price", () => {
  const fill = makeFill({
    commissions: [
      new Commission({ amount: new Money({ amount: "0.002", asset: baseAsset }) }),
    ],
  })
  assert.deepEqual(calculateFillCommissionRate({ market, fill }), { rate: "0.001" })
})

test("aggregates multiple base and quote commission entries", () => {
  const fill = makeFill({
    commissions: [
      new Commission({ amount: new Money({ amount: "0.001", asset: baseAsset }) }),
      new Commission({ amount: new Money({ amount: "0.1", asset: quoteAsset }) }),
    ],
  })
  assert.deepEqual(calculateFillCommissionRate({ market, fill }), { rate: "0.001" })
})

test("rejects incomplete commission data", () => {
  assert.throws(
    () => calculateFillCommissionRate({
      market,
      fill: makeFill({ commissionStatus: "UNKNOWN" }),
    }),
    /incomplete commission data/,
  )
})

test("rejects non-zero third-asset commissions", () => {
  const fill = makeFill({
    commissions: [
      new Commission({ amount: new Money({ amount: "0.001", asset: thirdAsset }) }),
    ],
  })
  assert.throws(
    () => calculateFillCommissionRate({ market, fill }),
    /third-asset commission/,
  )
})

test("rejects a fill from another market", () => {
  const otherMarket = new Market({
    venue: "binance",
    symbol: "ETHUSDT",
    baseAsset: new Asset({ id: "asset:ETH", code: "ETH" }),
    quoteAsset,
  })
  assert.throws(
    () => calculateFillCommissionRate({ market, fill: makeFill({ market: otherMarket }) }),
    /does not match/,
  )
})
