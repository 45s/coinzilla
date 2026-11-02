import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../portfolio/portfolio.js"
import { evaluateAggressiveStrategy } from "./aggressive-strategy.js"

const marketPrice = { symbol: "BTCUSDT", price: "65000.12", timestamp: 123 }
const baseAsset = new Asset({ id: "asset:BTC", code: "BTC" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "BTCUSDT", baseAsset, quoteAsset })
const buyFill = new Fill({
  tradeId: "trade-1",
  brokerOrderId: "order-1",
  market,
  side: "BUY",
  price: new Money({ amount: "10", asset: quoteAsset }),
  quantity: new Quantity({ amount: "0.5", asset: baseAsset }),
  quoteQuantity: new Money({ amount: "5", asset: quoteAsset }),
  commissions: [],
  commissionStatus: "COMPLETE",
})

test("is the active Aggressive policy and blocks unsafe initial grid assumptions", () => {
  const decision = evaluateAggressiveStrategy({
    marketPrice,
    pairConfig: { makerPercent: 0, orderQuantity: 0.01 },
    portfolio: new Portfolio(),
  })
  assert.equal(decision.strategy, "AGGRESSIVE")
  assert.equal(decision.action, "NO_ACTION")
  assert.deepEqual(decision.blockers, ["BUY_GRID_DEPTH_NOT_CONFIGURED"])
})

test("exposes the current Position and blocks unresolved SELL pricing", () => {
  const portfolio = new Portfolio().applyFill({ fill: buyFill }).portfolio
  const decision = evaluateAggressiveStrategy({
    marketPrice,
    pairConfig: { makerPercent: 0 },
    portfolio,
  })
  assert.equal(decision.action, "NO_ACTION")
  assert.equal(decision.position.baseQuantity.amount, "0.5")
  assert.ok(decision.blockers.includes("SELL_PRICE_FORMULA_UNRESOLVED"))
})

test("requires a Portfolio input", () => {
  assert.throws(
    () => evaluateAggressiveStrategy({ marketPrice, pairConfig: {}, portfolio: {} }),
    /requires a Portfolio/,
  )
})
