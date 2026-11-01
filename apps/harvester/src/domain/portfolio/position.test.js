import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Position } from "./position.js"

const baseAsset = new Asset({ id: "asset:BTC", code: "BTC" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "BTCUSDT", baseAsset, quoteAsset })
const makeFill = ({
  side = "BUY",
  quantity = "2",
  quoteQuantity = "200",
  commissions = [],
  commissionStatus = "COMPLETE",
  tradeId = "trade-1",
} = {}) => new Fill({
  tradeId,
  brokerOrderId: "order-1",
  market,
  side,
  price: new Money({ amount: "100", asset: quoteAsset }),
  quantity: new Quantity({ amount: quantity, asset: baseAsset }),
  quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
  commissions,
  commissionStatus,
})

test("applies BUY fills and base/quote commissions exactly", () => {
  const position = Position.empty({ market }).applyFill({
    fill: makeFill({
      commissions: [
        new Commission({ amount: new Money({ amount: "0.01", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.2", asset: quoteAsset }) }),
      ],
    }),
  })
  assert.equal(position.baseQuantity.amount, "1.99")
  assert.equal(position.quoteNetCashFlow.amount, "-200.2")
})

test("applies SELL fills and base/quote commissions to net holdings", () => {
  const bought = Position.empty({ market }).applyFill({ fill: makeFill() })
  const sold = bought.applyFill({
    fill: makeFill({
      side: "SELL",
      quantity: "1",
      quoteQuantity: "120",
      tradeId: "trade-2",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.01", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.1", asset: quoteAsset }) }),
      ],
    }),
  })
  assert.equal(sold.baseQuantity.amount, "0.99")
  assert.equal(sold.quoteNetCashFlow.amount, "-80.1")
})

test("rejects incomplete commissions and third-asset fees", () => {
  assert.throws(
    () => Position.empty({ market }).applyFill({ fill: makeFill({ commissionStatus: "UNKNOWN" }) }),
    /complete commission data/,
  )
  const thirdAsset = new Asset({ id: "asset:BNB", code: "BNB" })
  const thirdAssetFill = makeFill({
    commissions: [new Commission({ amount: new Money({ amount: "0.01", asset: thirdAsset }) })],
  })
  assert.throws(() => Position.empty({ market }).applyFill({ fill: thirdAssetFill }), /third-asset commission/)
})

test("rejects SELL fills that exceed available base inventory", () => {
  assert.throws(
    () => Position.empty({ market }).applyFill({
      fill: makeFill({ side: "SELL", tradeId: "sell-first" }),
    }),
    /base quantity negative/,
  )
})
