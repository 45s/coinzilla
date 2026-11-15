import assert from "node:assert/strict"
import test from "node:test"
import { Market } from "@coinzilla/entities"
import { createCanonicalMarket } from "./create-canonical-market.js"

test("creates a canonical Bitunix Spot market from trading-pair metadata", () => {
  const market = createCanonicalMarket({
    symbolInfo: {
      base: "btc",
      quote: "usdt",
      basePrecision: "8",
      quotePrecision: "2",
      symbol: "BTCUSDT",
      minPrice: "0.01",
      minVolume: "0.001",
    },
  })

  assert.ok(market instanceof Market)
  assert.equal(market.venue, "bitunix")
  assert.equal(market.symbol, "BTCUSDT")
  assert.equal(market.baseAsset.code, "BTC")
  assert.equal(market.quoteAsset.code, "USDT")
  assert.equal(market.id, "bitunix:BTCUSDT")
})

test("rejects malformed Bitunix market metadata rather than inventing assets", () => {
  for (const symbolInfo of [
    null,
    {},
    { symbol: "BTCUSDT",
      base: "BTC" },
    { symbol: "BTCUSDT",
      base: "BTC",
      quote: "USDT",
      isOpen: "0" },
  ]) {
    assert.throws(() => createCanonicalMarket({ symbolInfo }))
  }
})
