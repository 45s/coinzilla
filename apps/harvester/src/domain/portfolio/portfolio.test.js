import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "./portfolio.js"

const baseAsset = new Asset({ id: "asset:ETH", code: "ETH" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "ETHUSDT", baseAsset, quoteAsset })
const makeFill = ({ tradeId = "trade-1", quantity = "1" } = {}) => new Fill({
  tradeId,
  brokerOrderId: "order-1",
  market,
  side: "BUY",
  price: new Money({ amount: "100", asset: quoteAsset }),
  quantity: new Quantity({ amount: quantity, asset: baseAsset }),
  quoteQuantity: new Money({ amount: "100", asset: quoteAsset }),
  commissions: [],
  commissionStatus: "COMPLETE",
})

test("creates a Position from a fill without mutating the original Portfolio", () => {
  const original = new Portfolio()
  const result = original.applyFill({ fill: makeFill() })
  assert.equal(result.applied, true)
  assert.equal(original.positions.length, 0)
  assert.equal(result.portfolio.positions.length, 1)
  assert.equal(result.portfolio.getPosition({ symbol: "ETHUSDT" }).baseQuantity.amount, "1")
})

test("deduplicates a fill by canonical market-scoped identity", () => {
  const portfolio = new Portfolio().applyFill({ fill: makeFill() }).portfolio
  const duplicate = portfolio.applyFill({ fill: makeFill() })
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.applied, false)
  assert.equal(duplicate.portfolio, portfolio)
  assert.equal(duplicate.portfolio.getPosition({ symbol: "ETHUSDT" }).baseQuantity.amount, "1")
})

test("keeps positions isolated by canonical market identity", () => {
  const otherBase = new Asset({ id: "asset:SOL", code: "SOL" })
  const otherMarket = new Market({ venue: "binance", symbol: "SOLUSDT", baseAsset: otherBase, quoteAsset })
  const otherFill = new Fill({
    tradeId: "trade-1",
    brokerOrderId: "order-2",
    market: otherMarket,
    side: "BUY",
    price: new Money({ amount: "100", asset: quoteAsset }),
    quantity: new Quantity({ amount: "2", asset: otherBase }),
    quoteQuantity: new Money({ amount: "200", asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const portfolio = new Portfolio()
    .applyFill({ fill: makeFill() }).portfolio
    .applyFill({ fill: otherFill }).portfolio
  assert.equal(portfolio.positions.length, 2)
})
