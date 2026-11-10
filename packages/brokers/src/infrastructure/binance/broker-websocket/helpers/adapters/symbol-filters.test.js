import assert from "node:assert/strict"
import test from "node:test"

import { adaptSymbolFiltersResponse } from "./symbol-filters.js"

const completeSymbolInfo = {
  symbol: "BTCUSDT",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  orderTypes: ["LIMIT", "MARKET"],
  filters: [
    {
      filterType: "PRICE_FILTER",
      tickSize: "0.010000",
      minPrice: "0.00000000",
      maxPrice: "100000.00000000",
    },
    {
      filterType: "LOT_SIZE",
      stepSize: "0.000100",
      minQty: "0.000000",
      maxQty: "9000.000000",
    },
    {
      filterType: "NOTIONAL",
      minNotional: "5.00",
      maxNotional: "1000000.00",
    },
    {
      filterType: "MIN_NOTIONAL",
      minNotional: "10.00",
    },
  ],
}

test("maps required and optional Binance market filters without decimal normalization", () => {
  assert.deepEqual(adaptSymbolFiltersResponse({
    symbol: "BTCUSDT",
    exchangeInfo: { symbols: [completeSymbolInfo] },
  }), {
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    tickSize: "0.010000",
    stepSize: "0.000100",
    minPrice: "0.00000000",
    maxPrice: "100000.00000000",
    minQuantity: "0.000000",
    maxQuantity: "9000.000000",
    minNotional: "5.00",
    maxNotional: "1000000.00",
    supportedOrderTypes: ["LIMIT", "MARKET"],
  })
})

test("falls back to legacy MIN_NOTIONAL only when NOTIONAL is absent", () => {
  const symbolInfo = {
    ...completeSymbolInfo,
    filters: completeSymbolInfo.filters.filter((filter) => filter.filterType !== "NOTIONAL"),
  }
  const result = adaptSymbolFiltersResponse({
    symbol: "BTCUSDT",
    exchangeInfo: { symbols: [symbolInfo] },
  })
  assert.equal(result.minNotional, "10.00")
})

test("omits optional filter fields when Binance does not provide them", () => {
  const symbolInfo = {
    ...completeSymbolInfo,
    filters: [
      { filterType: "PRICE_FILTER", tickSize: "0.01" },
      { filterType: "LOT_SIZE", stepSize: "0.001" },
    ],
  }
  assert.deepEqual(adaptSymbolFiltersResponse({
    symbol: "BTCUSDT",
    exchangeInfo: { symbols: [symbolInfo] },
  }), {
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    tickSize: "0.01",
    stepSize: "0.001",
    supportedOrderTypes: ["LIMIT", "MARKET"],
  })
})

test("rejects missing, malformed, and non-positive required filters", () => {
  const missingTick = {
    ...completeSymbolInfo,
    filters: completeSymbolInfo.filters.filter((filter) => filter.filterType !== "PRICE_FILTER"),
  }
  assert.throws(() => adaptSymbolFiltersResponse({
    symbol: "BTCUSDT", exchangeInfo: { symbols: [missingTick] },
  }), /PRICE_FILTER\.tickSize missing/)

  const malformedTick = {
    ...completeSymbolInfo,
    filters: completeSymbolInfo.filters.map((filter) =>
      filter.filterType === "PRICE_FILTER" ? { ...filter, tickSize: "NaN" } : filter),
  }
  assert.throws(() => adaptSymbolFiltersResponse({
    symbol: "BTCUSDT", exchangeInfo: { symbols: [malformedTick] },
  }), /PRICE_FILTER\.tickSize is invalid/)

  const zeroStep = {
    ...completeSymbolInfo,
    filters: completeSymbolInfo.filters.map((filter) =>
      filter.filterType === "LOT_SIZE" ? { ...filter, stepSize: "0" } : filter),
  }
  assert.throws(() => adaptSymbolFiltersResponse({
    symbol: "BTCUSDT", exchangeInfo: { symbols: [zeroStep] },
  }), /LOT_SIZE\.stepSize missing or non-positive/)
})

test("rejects incomplete market metadata and invalid optional decimal filters", () => {
  const incomplete = { ...completeSymbolInfo, baseAsset: "", orderTypes: [] }
  assert.throws(() => adaptSymbolFiltersResponse({
    symbol: "BTCUSDT", exchangeInfo: { symbols: [incomplete] },
  }), /market metadata is incomplete/)

  const invalidOptional = {
    ...completeSymbolInfo,
    filters: completeSymbolInfo.filters.map((filter) =>
      filter.filterType === "PRICE_FILTER" ? { ...filter, minPrice: "-1" } : filter),
  }
  assert.throws(() => adaptSymbolFiltersResponse({
    symbol: "BTCUSDT", exchangeInfo: { symbols: [invalidOptional] },
  }), /PRICE_FILTER\.minPrice must be non-negative/)
})

test("rejects exchange-info responses that do not contain the requested symbol", () => {
  assert.throws(() => adaptSymbolFiltersResponse({
    symbol: "BTCUSDT",
    exchangeInfo: { symbols: [{ ...completeSymbolInfo, symbol: "ETHUSDT" }] },
  }), /PRICE_FILTER\.tickSize missing for BTCUSDT/)
})
