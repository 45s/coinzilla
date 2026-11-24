import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"

const credentials = {
  apiKey: "bitunix-futures-market-data-test-key",
  apiSecret: "bitunix-futures-market-data-test-secret",
}

function createFuturesResponse({ data }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      code: 0,
      data,
    }),
  }
}

test("Bitunix Futures getPrices maps the last traded price and mark price from the public ticker", async () => {
  const requests = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        fetchFn: async (...requestArgs) => {
          const [url, options] = requestArgs
          requests.push({
            url,
            options,
          })
          return createFuturesResponse({
            data: [{
              symbol: "BTCUSDT",
              markPrice: "100.20",
              lastPrice: "100.25",
              open: "99.00",
              last: "100.25",
              quoteVol: "1000",
              baseVol: "10",
              high: "101.00",
              low: "98.00",
            }],
          })
        },
      },
    },
  })

  const result = await broker.getPrices({
    symbol: "BTCUSDT",
  })

  assert.equal(result.ok, true, "a valid public Futures ticker must return a successful price result")
  assert.deepEqual(result.data, {
    symbol: "BTCUSDT",
    price: "100.25",
    markPrice: "100.20",
  }, "the common one-shot price result must preserve exact last and mark price strings")
  assert.equal(requests.length, 1, "one symbol ticker request must be dispatched exactly once")
  assert.equal(requests[0].url, "https://fapi.bitunix.com/api/v1/futures/market/tickers?symbols=BTCUSDT", "the ticker request must use the documented Futures endpoint and symbols query")
  assert.equal(requests[0].options.method, "GET", "ticker reads must use GET")
  assert.equal(Object.hasOwn(requests[0].options.headers, "api-key"), false, "public ticker reads must not include authentication")
})

test("Bitunix Futures getCandles returns chronologically ordered closed candles with exact decimal fields", async () => {
  const requests = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        fetchFn: async (...requestArgs) => {
          const [url, options] = requestArgs
          requests.push({
            url,
            options,
          })
          return createFuturesResponse({
            data: [{
              time: 1_700_000_000_000,
              open: "100.10",
              high: "101.20",
              low: "99.90",
              close: "100.80",
              baseVol: "12.3400",
              quoteVol: "1240.000",
            }],
          })
        },
      },
    },
  })

  const result = await broker.getCandles({
    symbol: "BTCUSDT",
    interval: "1h",
    limit: 1,
    endTime: 1_700_003_600_000,
    type: "LAST_PRICE",
  })

  assert.equal(result.ok, true, "a valid Futures kline response must return successful normalized candles")
  assert.equal(result.data.length, 1, "the requested kline page must be preserved")
  assert.deepEqual(result.data[0], {
    symbol: "BTCUSDT",
    interval: "1h",
    openTime: 1_700_000_000_000,
    closeTime: 1_700_003_599_999,
    open: "100.10",
    high: "101.20",
    low: "99.90",
    close: "100.80",
    volume: "12.3400",
    isClosed: true,
  }, "Futures kline values must retain exact decimal strings and closed-candle semantics")
  const requestUrl = new URL(requests[0].url)
  assert.equal(requestUrl.pathname, "/api/v1/futures/market/kline", "the candle query must use the Futures kline endpoint")
  assert.equal(requestUrl.searchParams.get("endTime"), "1700003600000", "endTime must remain the documented exclusive upper bound")
  assert.equal(requestUrl.searchParams.get("interval"), "1h", "the requested candle interval must be preserved")
  assert.equal(requestUrl.searchParams.get("type"), "LAST_PRICE", "the requested price source must be explicit")
  assert.equal(requests[0].options.method, "GET", "candle reads must use GET")
  assert.equal(Object.hasOwn(requests[0].options.headers, "api-key"), false, "public candle reads must not include authentication")
})

test("Bitunix Futures getCandles rejects unsupported startTime instead of silently ignoring it", async () => {
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
  })

  const result = await broker.getCandles({
    symbol: "BTCUSDT",
    interval: "1h",
    startTime: 1_700_000_000_000,
  })

  assert.equal(result.ok, false, "an unsupported time-range field must not be silently ignored")
  assert.match(result.errors[0].message, /startTime is not supported/, "the caller must be told that the Futures endpoint has no startTime parameter")
})
