import assert from "node:assert/strict"
import test from "node:test"

import { Asset, Fill, Market } from "@coinzilla/entities"
import {
  adaptCanonicalFills,
  createCanonicalFillMarket,
} from "./canonical-fills.js"

const exchangeInfo = {
  symbols: [{
    symbol: "BTCUSDT",
    baseAsset: " btc ",
    quoteAsset: " usdt ",
  }],
}

const trade = {
  id: 42,
  orderId: 7,
  isBuyer: true,
  isMaker: false,
  price: "65000.12000000",
  qty: "0.00010001",
  quoteQty: "6.5060120012",
  commission: "0",
  commissionAsset: null,
  time: 1_798_000_000_000,
}

test("builds a canonical fill market from the exact Binance symbol metadata", () => {
  const market = createCanonicalFillMarket({ symbol: "BTCUSDT", exchangeInfo })

  assert.ok(market instanceof Market)
  assert.equal(market.venue, "binance")
  assert.equal(market.symbol, "BTCUSDT")
  assert.ok(market.baseAsset instanceof Asset)
  assert.ok(market.quoteAsset instanceof Asset)
  assert.deepEqual(market.baseAsset.value, { id: "btc", code: "BTC" })
  assert.deepEqual(market.quoteAsset.value, { id: "usdt", code: "USDT" })
})

test("rejects missing or ambiguous market metadata", () => {
  assert.throws(() => createCanonicalFillMarket({
    symbol: "BTCUSDT",
    exchangeInfo: { symbols: [] },
  }), /market metadata is missing or ambiguous/)

  assert.throws(() => createCanonicalFillMarket({
    symbol: "BTCUSDT",
    exchangeInfo: { symbols: [exchangeInfo.symbols[0], exchangeInfo.symbols[0]] },
  }), /market metadata is missing or ambiguous/)
})

test("rejects incomplete base or quote asset metadata", () => {
  for (const symbolInfo of [
    { ...exchangeInfo.symbols[0], baseAsset: " " },
    { ...exchangeInfo.symbols[0], quoteAsset: "" },
    { symbol: "BTCUSDT", baseAsset: 1, quoteAsset: "USDT" },
  ]) {
    assert.throws(() => createCanonicalFillMarket({
      symbol: "BTCUSDT",
      exchangeInfo: { symbols: [symbolInfo] },
    }), /market metadata is incomplete/)
  }
})

test("maps trade arrays to canonical Fill entities while preserving the market identity", () => {
  const market = createCanonicalFillMarket({ symbol: "BTCUSDT", exchangeInfo })
  const fills = adaptCanonicalFills({ trades: [trade], market })

  assert.equal(fills.length, 1)
  assert.ok(fills[0] instanceof Fill)
  assert.strictEqual(fills[0].market, market)
  assert.equal(fills[0].tradeId, "42")
  assert.equal(fills[0].brokerOrderId, "7")
  assert.equal(fills[0].side, "BUY")
  assert.equal(fills[0].price.amount, "65000.12")
  assert.equal(fills[0].quantity.amount, "0.00010001")
  assert.equal(fills[0].quoteQuantity.amount, "6.5060120012")
})

test("accepts an empty trade list and rejects non-array responses", () => {
  const market = createCanonicalFillMarket({ symbol: "BTCUSDT", exchangeInfo })
  assert.deepEqual(adaptCanonicalFills({ trades: [], market }), [])
  for (const trades of [undefined, null, {}, "not-an-array"]) {
    assert.throws(() => adaptCanonicalFills({ trades, market }), /myTrades response should be an array/)
  }
})
