import assert from "node:assert/strict"
import test from "node:test"
import { Asset, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Position } from "../portfolio/position.js"
import { Portfolio } from "../portfolio/portfolio.js"
import { createOrderOwnership } from "../orders/order-ownership.js"
import { StrategyId, normalizeStrategyId } from "./strategy-ids.js"

const baseAsset = new Asset({
  id: "asset:ETH",
  code: "ETH",
})
const quoteAsset = new Asset({
  id: "asset:USDT",
  code: "USDT",
})
const market = new Market({
  venue: "binance",
  symbol: "ETHUSDT",
  baseAsset,
  quoteAsset,
})

function makeFill() {
  return new Fill({
    tradeId: "strategy-normalization-test",
    brokerOrderId: "order-1",
    market,
    side: "BUY",
    price: new Money({
      amount: "100",
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: "1",
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: "100",
      asset: quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

test("normalizes valid strategy IDs without restricting future strategy registrations", () => {
  assert.equal(
    normalizeStrategyId({ strategyId: "  future_strategy  " }),
    "future_strategy",
    "A valid future strategy ID must be trimmed without requiring current registry membership.",
  )
  assert.equal(
    normalizeStrategyId({ strategyId: StrategyId.COIN_GRABBER }),
    StrategyId.COIN_GRABBER,
    "Canonical persisted strategy IDs must remain byte-for-byte unchanged during normalization.",
  )
})

test("rejects missing, blank, and non-string strategy IDs", () => {
  for (const invalidStrategyId of [undefined, null, "", "   ", 42, {}]) {
    assert.throws(
      () => normalizeStrategyId({ strategyId: invalidStrategyId }),
      TypeError,
      "Strategy identity normalization must reject missing, blank, and non-string values instead of producing an ambiguous owner.",
    )
  }
})

test("Position normalizes its strategy owner and derived identity", () => {
  const position = Position.empty({
    market,
    strategyId: " future_strategy ",
  })

  assert.equal(
    position.strategyId,
    "future_strategy",
    "A Position must retain the normalized strategy owner rather than whitespace-padded identity.",
  )
  assert.equal(
    position.positionId,
    JSON.stringify([market.id, "future_strategy"]),
    "A derived Position ID must use the same normalized strategy ID as its owner.",
  )
})

test("Portfolio normalizes strategy ownership before Position storage and selection", () => {
  const result = new Portfolio().applyFill({
    fill: makeFill(),
    strategyId: " future_strategy ",
  })

  assert.equal(
    result.portfolio.getPosition({
      symbol: "ETHUSDT",
      strategyId: "future_strategy",
    }).strategyId,
    "future_strategy",
    "Portfolio selectors and stored Position ownership must use the same normalized strategy identity.",
  )
})

test("OrderRegistry ownership preserves normalized strategy identity", () => {
  const ownership = createOrderOwnership({
    ownership: {
      clientOrderId: "client-1",
      strategyId: " future_strategy ",
      positionId: "position-1",
      purpose: "RECOVERY_SELL",
    },
    clientOrderId: "client-1",
  })

  assert.equal(
    ownership.strategyId,
    "future_strategy",
    "Canonical order ownership must normalize strategy identity before freezing its attribution.",
  )
})

test("Portfolio rejects blank strategy IDs for fill ownership", () => {
  assert.throws(
    () => new Portfolio().applyFill({
      fill: makeFill(),
      strategyId: "   ",
    }),
    TypeError,
    "Portfolio fill ownership must reject a blank strategy ID using the same canonical normalization rule.",
  )
})

test("Portfolio rejects blank strategy IDs for ownership selectors", () => {
  assert.throws(
    () => new Portfolio().getPositions({ strategyId: "   " }),
    TypeError,
    "Portfolio strategy selectors must reject blank identifiers instead of matching ambiguous ownership.",
  )
})
