import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotBroker } from "./broker.js"

const DEPTH_PATH = "/api/spot/v1/market/depth"
const KLINE_PATH = "/api/spot/v1/market/kline"
const KLINE_HISTORY_PATH = "/api/spot/v1/market/kline/history"

function createBroker({ responses = {} } = {}) {
  const calls = []
  const restClient = {
    async request(input = {}) {
      const { method, path, ...options } = input
      calls.push({
        method,
        path,
        options,
      })
      if (responses[path] instanceof Error) {
        throw responses[path]
      }
      return {
        data: responses[path],
      }
    },
  }
  const broker = new BitunixSpotBroker({
    apiKey: "key",
    apiSecret: "secret",
    tradingMode: "live",
    dependencies: {
      restClientFactory: () => restClient,
    },
  })
  return {
    broker,
    calls,
  }
}

const validKline = {
  symbol: "BTCUSDT",
  open: "100.00",
  high: "110.00",
  low: "90.00",
  close: "105.00",
  ts: "2026-11-17T12:00:00Z",
}

test("Bitunix Spot order book reads require and forward the caller-selected precision", async () => {
  const depth = {
    asks: [
      {
        price: "101.25",
        volume: "2.5",
      },
    ],
    bids: [
      {
        price: "101.00",
        volume: "3.5",
      },
    ],
    ts: "1794916800000",
  }
  const { broker, calls } = createBroker({
    responses: {
      [DEPTH_PATH]: depth,
    },
  })

  const result = await broker.getOrderBook({
    symbol: "btcusdt",
    precision: 0.01,
  })

  assert.equal(result.ok, true, "a documented depth response must produce a successful order-book read")
  assert.deepEqual(result.data, {
    symbol: "BTCUSDT",
    timestamp: "1794916800000",
    asks: [
      {
        price: "101.25",
        quantity: "2.5",
      },
    ],
    bids: [
      {
        price: "101.00",
        quantity: "3.5",
      },
    ],
  }, "order-book levels must preserve exact exchange decimals and source timestamp text")
  assert.deepEqual(calls[0], {
    method: "GET",
    path: DEPTH_PATH,
    options: {
      queryParams: {
        symbol: "BTCUSDT",
        precision: 0.01,
      },
    },
  }, "the required caller-selected precision must reach the documented REST endpoint unchanged")
})

test("Bitunix Spot order book rejects missing precision and malformed depth levels before returning data", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [DEPTH_PATH]: {
        asks: [
          {
            price: "101.00",
            volume: "not-a-decimal",
          },
        ],
        bids: [],
        ts: "1794916800000",
      },
    },
  })

  const missingPrecision = await broker.getOrderBook({
    symbol: "BTCUSDT",
  })
  const malformedLevel = await broker.getOrderBook({
    symbol: "BTCUSDT",
    precision: 0,
  })

  assert.equal(missingPrecision.ok, false, "depth precision is required by the official Spot endpoint")
  assert.match(missingPrecision.errors[0].message, /precision/i, "missing depth precision must explain the rejected input")
  assert.equal(malformedLevel.ok, false, "malformed price or volume values must not escape as order-book levels")
  assert.equal(calls.length, 1, "invalid precision must be rejected before a request while malformed responses require one request")
})

test("Bitunix Spot current kline reads preserve documented OHLC and ISO timestamp fields", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [KLINE_PATH]: validKline,
    },
  })

  const result = await broker.getKlines({
    symbol: "btcusdt",
    interval: "60",
  })

  assert.equal(result.ok, true, "a valid documented current-kline response must be returned")
  assert.deepEqual(result.data, {
    symbol: "BTCUSDT",
    open: "100.00",
    high: "110.00",
    low: "90.00",
    close: "105.00",
    timestamp: "2026-11-17T12:00:00Z",
  }, "current klines must preserve exact OHLC strings and the exchange timestamp without inventing volume")
  assert.deepEqual(calls[0].options.queryParams, {
    symbol: "BTCUSDT",
    interval: "60",
  }, "current-kline requests must use the caller's documented interval")
})

test("Bitunix Spot current kline rejects invalid intervals, foreign symbols, and inconsistent OHLC values", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [KLINE_PATH]: {
        ...validKline,
        symbol: "ETHUSDT",
        high: "99.00",
      },
    },
  })

  const invalidInterval = await broker.getKlines({
    symbol: "BTCUSDT",
    interval: "2",
  })
  const invalidResponse = await broker.getKlines({
    symbol: "BTCUSDT",
    interval: "60",
  })

  assert.equal(invalidInterval.ok, false, "undocumented kline intervals must be rejected before transport")
  assert.equal(invalidResponse.ok, false, "foreign-symbol and inconsistent OHLC responses must fail closed")
  assert.equal(calls.length, 1, "only the valid request may reach the exchange client")
})

test("Bitunix Spot kline history forwards bounded query parameters and normalizes a single documented row", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [KLINE_HISTORY_PATH]: validKline,
    },
  })

  const result = await broker.getKlineHistory({
    symbol: "BTCUSDT",
    interval: "1",
    endTime: 1794916800,
    limit: 100,
  })

  assert.equal(result.ok, true, "a valid historical kline row must be returned as a one-row history page")
  assert.deepEqual(result.data, [
    {
      symbol: "BTCUSDT",
      open: "100.00",
      high: "110.00",
      low: "90.00",
      close: "105.00",
      timestamp: "2026-11-17T12:00:00Z",
    },
  ], "single-object history responses must be normalized to a row list without fabricating OHLCV volume")
  assert.deepEqual(calls[0].options.queryParams, {
    symbol: "BTCUSDT",
    interval: "1",
    endTime: "1794916800",
    limit: "100",
  }, "history time bounds must use the documented Unix-seconds representation")
})

test("Bitunix Spot kline history rejects unsupported startTime and malformed rows before returning partial history", async () => {
  const { broker, calls } = createBroker({
    responses: {
      [KLINE_HISTORY_PATH]: [
        validKline,
        {
          ...validKline,
          close: "not-a-decimal",
        },
      ],
    },
  })

  const unsupportedStart = await broker.getKlineHistory({
    symbol: "BTCUSDT",
    startTime: 1794910000000,
  })
  const malformedHistory = await broker.getKlineHistory({
    symbol: "BTCUSDT",
    limit: 2,
  })

  assert.equal(unsupportedStart.ok, false, "the Spot history endpoint has no documented startTime parameter")
  assert.equal(malformedHistory.ok, false, "one malformed row must reject the complete page instead of returning partial history")
  assert.equal(calls.length, 1, "unsupported startTime must be rejected before any request")
})
