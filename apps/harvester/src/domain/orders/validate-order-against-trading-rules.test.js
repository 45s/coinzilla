import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Market, Money, Quantity, TradingRules } from "@coinzilla/entities"
import { validateOrderAgainstTradingRules } from "./validate-order-against-trading-rules.js"

const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
const rules = new TradingRules({
  market,
  constraints: [
    { type: "PRICE_INCREMENT", status: "SUPPORTED", value: new Money({ amount: "0.001", asset: quoteAsset }) },
    { type: "MIN_PRICE", status: "SUPPORTED", value: new Money({ amount: "0.01", asset: quoteAsset }) },
    { type: "MAX_PRICE", status: "SUPPORTED", value: new Money({ amount: "10", asset: quoteAsset }) },
    { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: new Quantity({ amount: "0.1", asset: baseAsset }) },
    { type: "MIN_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: "1", asset: baseAsset }) },
    { type: "MAX_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: "1000", asset: baseAsset }) },
    { type: "MIN_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: "5", asset: quoteAsset }) },
    { type: "MAX_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: "5000", asset: quoteAsset }) },
  ],
})
const makeOrder = ({ price = "0.1", quantity = "100", market: orderMarket = market } = {}) =>
  new CanonicalOrder({
    clientOrderId: "h-12345678901234567890123456789012",
    market: orderMarket,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: price, asset: orderMarket.quoteAsset }),
    originalQuantity: new Quantity({ amount: quantity, asset: orderMarket.baseAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: orderMarket.baseAsset }),
    status: "PENDING",
  })

test("accepts an order aligned to exchange increments and within all supported bounds", () => {
  const result = validateOrderAgainstTradingRules({ order: makeOrder(), tradingRules: rules })
  assert.equal(result.valid, true)
  assert.equal(result.notional, "10")
})

test("rejects prices and quantities that do not align to exchange increments", () => {
  assert.throws(
    () => validateOrderAgainstTradingRules({ order: makeOrder({ price: "0.1001" }), tradingRules: rules }),
    /PRICE_INCREMENT/,
  )
  assert.throws(
    () => validateOrderAgainstTradingRules({ order: makeOrder({ quantity: "100.15" }), tradingRules: rules }),
    /QUANTITY_INCREMENT/,
  )
})

test("rejects min/max price, quantity and notional violations", () => {
  for (const [order, expected] of [
    [makeOrder({ price: "0.009" }), "MIN_PRICE"],
    [makeOrder({ price: "10.001" }), "MAX_PRICE"],
    [makeOrder({ quantity: "0.9" }), "MIN_QUANTITY"],
    [makeOrder({ quantity: "1001" }), "MAX_QUANTITY"],
    [makeOrder({ price: "0.01", quantity: "100" }), "MIN_NOTIONAL"],
    [makeOrder({ price: "10", quantity: "501" }), "MAX_NOTIONAL"],
  ]) {
    assert.throws(
      () => validateOrderAgainstTradingRules({ order, tradingRules: rules }),
      new RegExp(expected),
    )
  }
})

test("rejects mismatched market and missing required exchange rules", () => {
  const otherMarket = new Market({
    venue: "binance",
    symbol: "ETHUSDT",
    baseAsset: new Asset({ id: "eth", code: "ETH" }),
    quoteAsset,
  })
  assert.throws(
    () => validateOrderAgainstTradingRules({ order: makeOrder({ market: otherMarket }), tradingRules: rules }),
    /does not match/,
  )
  const incompleteRules = new TradingRules({
    market,
    constraints: rules.constraints.filter(({ type }) => type !== "MIN_NOTIONAL"),
  })
  assert.throws(
    () => validateOrderAgainstTradingRules({ order: makeOrder(), tradingRules: incompleteRules }),
    /MIN_NOTIONAL/,
  )
})
