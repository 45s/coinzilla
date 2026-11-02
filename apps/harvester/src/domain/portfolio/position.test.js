import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Position } from "./position.js"
import { calculatePositionFill } from "./position-accounting.js"

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

test("calculates BUY accounting with base and quote commissions as a pure function", () => {
  const result = calculatePositionFill({
    market,
    baseQuantity: "0",
    quoteNetCashFlow: "0",
    fill: makeFill({
      commissions: [
        new Commission({ amount: new Money({ amount: "0.01", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.2", asset: quoteAsset }) }),
      ],
    }),
  })
  assert.deepEqual(result, { baseQuantity: "1.99", quoteNetCashFlow: "-200.2" })
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
  assert.equal(position.freeBaseQuantity.amount, "0")
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

test("rejects SELL fills that exceed available active inventory", () => {
  assert.throws(
    () => Position.empty({ market }).applyFill({
      fill: makeFill({ side: "SELL", tradeId: "sell-first" }),
    }),
    /base quantity negative/,
  )
})

test("allocates exactly keepQuantity into a separate permanent free-inventory bucket", () => {
  const position = Position.empty({ market }).applyFill({
    fill: makeFill({ quantity: "100", quoteQuantity: "10" }),
  })
  const retained = position.allocateFreeQuantity({ quantity: "1" })

  assert.equal(retained.baseQuantity.amount, "99")
  assert.equal(retained.freeBaseQuantity.amount, "1")
  assert.equal(retained.totalBaseQuantity.amount, "100")
})

test("future BUY fills increase active inventory without reusing free inventory", () => {
  const position = Position.empty({ market })
    .applyFill({ fill: makeFill({ quantity: "100", quoteQuantity: "10" }) })
    .allocateFreeQuantity({ quantity: "1" })
    .applyFill({
      fill: makeFill({
        quantity: "100",
        quoteQuantity: "9.8",
        tradeId: "trade-2",
      }),
    })

  assert.equal(position.baseQuantity.amount, "199")
  assert.equal(position.freeBaseQuantity.amount, "1")
  assert.equal(position.totalBaseQuantity.amount, "200")
})

test("rejects allocating more free inventory than active inventory", () => {
  const position = Position.empty({ market })
  assert.throws(
    () => position.allocateFreeQuantity({ quantity: "1" }),
    /exceeds active strategy inventory/,
  )
})

test("rejects zero or invalid free-inventory allocations", () => {
  const position = Position.empty({ market }).applyFill({
    fill: makeFill({ quantity: "2", quoteQuantity: "200" }),
  })
  assert.throws(() => position.allocateFreeQuantity({ quantity: "0" }), /greater than zero/)
  assert.throws(() => position.allocateFreeQuantity({ quantity: "nope" }))
})

test("SELL fills cannot consume previously allocated free inventory", () => {
  const position = Position.empty({ market })
    .applyFill({
      fill: makeFill({ quantity: "100", quoteQuantity: "10" }),
    })
    .allocateFreeQuantity({ quantity: "1" })

  const sold = position.applyFill({
    fill: makeFill({
      side: "SELL",
      quantity: "99",
      quoteQuantity: "10.5",
      tradeId: "recovery-sell",
    }),
  })

  assert.equal(sold.baseQuantity.amount, "0")
  assert.equal(sold.freeBaseQuantity.amount, "1")
  assert.equal(sold.totalBaseQuantity.amount, "1")
})
