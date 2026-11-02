import test from "node:test"
import assert from "node:assert/strict"
import { Market, TradingRules } from "@coinzilla/entities"
import { createBinanceMarketMetadata } from "./binance-market-metadata.js"

const baseFilters = {
  symbol: "BTCUSDT",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  tickSize: "0.01",
  stepSize: "0.00001",
  minPrice: "1",
  maxPrice: "1000000",
  minQuantity: "0.0001",
  maxQuantity: "100",
  minNotional: "5",
  maxNotional: "1000000",
  supportedOrderTypes: ["LIMIT", "LIMIT_MAKER", "MARKET"],
}

test("converts exact Binance filter strings into canonical Market and TradingRules", () => {
  const result = createBinanceMarketMetadata({ symbolFilters: baseFilters })

  assert.ok(result.market instanceof Market)
  assert.ok(result.tradingRules instanceof TradingRules)
  assert.equal(result.market.id, "binance:BTCUSDT")
  assert.equal(result.market.baseAsset.code, "BTC")
  assert.equal(result.market.quoteAsset.code, "USDT")
  assert.deepEqual(result.tradingRules.value.constraints.map(({ type, status }) => ({
    type,
    status,
  })), [
    { type: "PRICE_INCREMENT", status: "SUPPORTED" },
    { type: "MIN_PRICE", status: "SUPPORTED" },
    { type: "MAX_PRICE", status: "SUPPORTED" },
    { type: "QUANTITY_INCREMENT", status: "SUPPORTED" },
    { type: "MIN_QUANTITY", status: "SUPPORTED" },
    { type: "MAX_QUANTITY", status: "SUPPORTED" },
    { type: "MIN_NOTIONAL", status: "SUPPORTED" },
    { type: "MAX_NOTIONAL", status: "SUPPORTED" },
  ])
  assert.equal(result.tradingRules.constraints[0].value.amount, "0.01")
  assert.equal(result.tradingRules.constraints[3].value.amount, "0.00001")
  assert.deepEqual(result.supportedOrderTypes, ["LIMIT", "LIMIT_MAKER", "MARKET"])
})

test("represents absent and disabled zero optional constraints as UNSUPPORTED", () => {
  const result = createBinanceMarketMetadata({
    symbolFilters: {
      ...baseFilters,
      minPrice: "0",
      maxPrice: undefined,
      minQuantity: "0",
      maxQuantity: undefined,
      minNotional: "0",
      maxNotional: undefined,
    },
  })

  assert.deepEqual(
    result.tradingRules.constraints
      .filter(({ status }) => status !== "SUPPORTED")
      .map(({ type, status }) => ({ type, status })),
    [
      { type: "MIN_PRICE", status: "UNSUPPORTED" },
      { type: "MAX_PRICE", status: "UNSUPPORTED" },
      { type: "MIN_QUANTITY", status: "UNSUPPORTED" },
      { type: "MAX_QUANTITY", status: "UNSUPPORTED" },
      { type: "MIN_NOTIONAL", status: "UNSUPPORTED" },
      { type: "MAX_NOTIONAL", status: "UNSUPPORTED" },
    ],
  )
})

test("rejects missing required increments and malformed market metadata", () => {
  assert.throws(() => createBinanceMarketMetadata(), /symbolFilters must be an object/)
  assert.throws(() => createBinanceMarketMetadata({
    symbolFilters: { ...baseFilters, tickSize: "0" },
  }), /tickSize and stepSize must be greater than zero/)
  assert.throws(() => createBinanceMarketMetadata({
    symbolFilters: { ...baseFilters, stepSize: "not-a-decimal" },
  }))
  assert.throws(() => createBinanceMarketMetadata({
    symbolFilters: { ...baseFilters, baseAsset: "" },
  }), /baseAsset must be a non-empty asset code/)
  assert.throws(() => createBinanceMarketMetadata({
    symbolFilters: { ...baseFilters, supportedOrderTypes: ["LIMIT", "LIMIT"] },
  }), /unique non-empty strings/)
})

test("rejects negative optional filters and inverted bounds", () => {
  assert.throws(() => createBinanceMarketMetadata({
    symbolFilters: { ...baseFilters, minNotional: "-1" },
  }), /must be non-negative/)
  assert.throws(() => createBinanceMarketMetadata({
    symbolFilters: { ...baseFilters, minQuantity: "200", maxQuantity: "100" },
  }), /MIN_QUANTITY cannot exceed MAX_QUANTITY/)
})
