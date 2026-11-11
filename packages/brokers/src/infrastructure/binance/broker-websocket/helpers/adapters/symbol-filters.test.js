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
    unvalidatedConstraints: [],
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
    unvalidatedConstraints: [],
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


test("reports active dynamic and account-level filters as exchange-neutral unvalidated constraints", () => {
  const symbolInfo = {
    ...completeSymbolInfo,
    filters: [
      ...completeSymbolInfo.filters,
      { filterType: "PERCENT_PRICE_BY_SIDE", bidMultiplierUp: "1.2", bidMultiplierDown: "0.8", askMultiplierUp: "1.2", askMultiplierDown: "0.8", avgPriceMins: 5 },
      { filterType: "MAX_POSITION", maxPosition: "1000" },
      { filterType: "MAX_NUM_ORDERS", maxNumOrders: 25 },
      { filterType: "MARKET_LOT_SIZE", minQty: "0.001", maxQty: "1000", stepSize: "0.001" },
      { filterType: "MAX_NUM_ALGO_ORDERS", maxNumAlgoOrders: 5 },
      { filterType: "FUTURE_UNRECOGNIZED_FILTER" },
    ],
  }
  const result = adaptSymbolFiltersResponse({
    symbol: "BTCUSDT",
    exchangeInfo: {
      symbols: [symbolInfo],
      exchangeFilters: [
        { filterType: "EXCHANGE_MAX_NUM_ORDERS", maxNumOrders: 1000 },
      ],
    },
  })

  assert.deepEqual(result.unvalidatedConstraints, [
    { type: "DYNAMIC_PRICE_BAND", scope: "SYMBOL", sourceFilterType: "PERCENT_PRICE_BY_SIDE" },
    { type: "BASE_ASSET_POSITION_LIMIT", scope: "ACCOUNT", sourceFilterType: "MAX_POSITION" },
    { type: "OPEN_ORDER_COUNT_PER_MARKET", scope: "ACCOUNT", sourceFilterType: "MAX_NUM_ORDERS" },
    { type: "UNMODELED_EXCHANGE_CONSTRAINT", scope: "SYMBOL", sourceFilterType: "FUTURE_UNRECOGNIZED_FILTER" },
    { type: "OPEN_ORDER_COUNT_EXCHANGE_WIDE", scope: "EXCHANGE", sourceFilterType: "EXCHANGE_MAX_NUM_ORDERS" },
  ], "Applicable dynamic, account and newly introduced filters must not disappear at the exchange adapter boundary; filters only applicable to unsupported MARKET/algo orders must not block LIMIT strategies.")
})


test("maps private MAX_ASSET filters into account-scoped unvalidated constraints", () => {
  const result = adaptSymbolFiltersResponse({
    symbol: "BTCUSDT",
    exchangeInfo: { symbols: [completeSymbolInfo] },
    accountFilters: {
      symbolFilters: [],
      exchangeFilters: [],
      assetFilters: [
        { filterType: "MAX_ASSET", asset: "USDT", limit: "1000" },
      ],
    },
  })

  assert.deepEqual(result.unvalidatedConstraints, [
    { type: "ASSET_ORDER_LIMIT", scope: "ACCOUNT", sourceFilterType: "MAX_ASSET" },
  ], "A private account asset limit must be retained even when it applies to the quote asset rather than the market's base asset.")
})


test("does not block a market for account asset filters belonging to unrelated assets", () => {
  const result = adaptSymbolFiltersResponse({
    symbol: "BTCUSDT",
    exchangeInfo: { symbols: [completeSymbolInfo] },
    accountFilters: {
      symbolFilters: [],
      exchangeFilters: [],
      assetFilters: [
        { filterType: "MAX_ASSET", asset: "ETH", limit: "10" },
      ],
    },
  })

  assert.deepEqual(result.unvalidatedConstraints, [], "An account-level asset filter must block only markets whose base or quote asset it actually constrains.")
})


test("preserves both dynamic price filter variants and excludes only unsupported order-feature filters", () => {
  const symbolInfo = {
    ...completeSymbolInfo,
    filters: [
      ...completeSymbolInfo.filters,
      { filterType: "PERCENT_PRICE", multiplierUp: "1.2", multiplierDown: "0.8", avgPriceMins: 5 },
      { filterType: "PERCENT_PRICE_BY_SIDE", bidMultiplierUp: "1.2", bidMultiplierDown: "0.8", askMultiplierUp: "1.2", askMultiplierDown: "0.8", avgPriceMins: 5 },
      { filterType: "MARKET_LOT_SIZE" },
      { filterType: "MAX_NUM_ALGO_ORDERS" },
      { filterType: "MAX_NUM_ICEBERG_ORDERS" },
      { filterType: "ICEBERG_PARTS" },
      { filterType: "TRAILING_DELTA" },
      { filterType: "MAX_NUM_ORDER_LISTS" },
      { filterType: "MAX_NUM_ORDER_AMENDS" },
    ],
  }

  const result = adaptSymbolFiltersResponse({
    symbol: "BTCUSDT",
    exchangeInfo: { symbols: [symbolInfo] },
  })

  assert.deepEqual(result.unvalidatedConstraints, [
    { type: "DYNAMIC_PRICE_BAND", scope: "SYMBOL", sourceFilterType: "PERCENT_PRICE" },
    { type: "DYNAMIC_PRICE_BAND", scope: "SYMBOL", sourceFilterType: "PERCENT_PRICE_BY_SIDE" },
  ], "Both dynamic price filters must block until evaluated, while filters exclusive to unsupported order features must not block ordinary LIMIT/LIMIT_MAKER orders.")
})


test("does not reclassify static rules repeated by the private relevant-filters response", () => {
  const result = adaptSymbolFiltersResponse({
    symbol: "BTCUSDT",
    exchangeInfo: { symbols: [completeSymbolInfo] },
    accountFilters: {
      symbolFilters: [
        { filterType: "PRICE_FILTER", tickSize: "0.01" },
        { filterType: "LOT_SIZE", stepSize: "0.001" },
        { filterType: "MIN_NOTIONAL", minNotional: "5" },
        { filterType: "PERCENT_PRICE", multiplierUp: "1.2", multiplierDown: "0.8", avgPriceMins: 5 },
      ],
      exchangeFilters: [],
      assetFilters: [],
    },
  });

  assert.deepEqual(result.unvalidatedConstraints, [
    { type: "DYNAMIC_PRICE_BAND", scope: "SYMBOL", sourceFilterType: "PERCENT_PRICE" },
  ], "The private relevant-filters response may repeat static filters; only additional applicable rules should be classified as unvalidated.");
});
