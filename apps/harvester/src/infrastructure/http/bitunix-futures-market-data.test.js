import assert from "node:assert/strict"
import test from "node:test"

import { createBitunixFuturesMarketDataClient } from "./bitunix-futures-market-data.js"

function createResponse(data) {
  return {
    ok: true,
    async json() {
      return data
    },
  }
}

test("loads Bitunix Futures contracts and ticker fields without deriving movement percentages", async () => {
  const requests = []
  const client = createBitunixFuturesMarketDataClient({
    now: () => new Date("2026-11-21T12:00:00.000Z"),
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options })
      if (String(url).endsWith("/trading_pairs")) {
        return createResponse({
          code: 0,
          data: [{
            symbol: "BTCUSDT",
            base: "BTC",
            quote: "USDT",
            symbolStatus: "OPEN",
            isApiSupported: true,
            maxLeverage: 125,
          }],
        })
      }
      return createResponse({
        code: 0,
        data: [{
          symbol: "BTCUSDT",
          lastPrice: "67000.10",
          markPrice: "67001.20",
          open: "65000.00",
          high: "68000.00",
          low: "64000.00",
          quoteVol: "123456.78",
          baseVol: "12.5",
        }],
      })
    },
  })

  const snapshot = await client.getBitunixFuturesMarkets()

  assert.equal(requests.length, 2, "The client must fetch contracts and tickers from the two public REST endpoints.")
  assert.ok(requests.every((request) => request.options.method === "GET"), "Market data must use read-only GET requests.")
  assert.ok(requests.every((request) => !("authorization" in request.options.headers)), "Public market-data requests must not require credentials.")
  assert.deepEqual(snapshot, {
    provider: "bitunix",
    marketType: "futures",
    observedAt: "2026-11-21T12:00:00.000Z",
    markets: [{
      symbol: "BTCUSDT",
      base: "BTC",
      quote: "USDT",
      symbolStatus: "OPEN",
      isApiSupported: true,
      maxLeverage: 125,
      lastPrice: "67000.10",
      markPrice: "67001.20",
      open: "65000.00",
      high: "68000.00",
      low: "64000.00",
      quoteVol: "123456.78",
      baseVol: "12.5",
      change5m: null,
      change1h: null,
      change4h: null,
      change24h: null,
    }],
  }, "The client must expose only returned exchange fields and keep every unavailable percentage as null.")
})

test("passes through a native 24-hour percentage field when the exchange response includes it", async () => {
  const client = createBitunixFuturesMarketDataClient({
    fetchImpl: async (url) => createResponse({
      code: 0,
      data: String(url).endsWith("/trading_pairs")
        ? [{ symbol: "ETHUSDT", base: "ETH", quote: "USDT" }]
        : [{ symbol: "ETHUSDT", r: "-1.25" }],
    }),
  })

  const snapshot = await client.getBitunixFuturesMarkets()

  assert.equal(snapshot.markets[0].change24h, "-1.25", "A native percentage value must be passed through unchanged, including its sign and precision.")
  assert.equal(snapshot.markets[0].change5m, null, "The client must not infer a 5-minute percentage from other ticker fields.")
})

test("rejects malformed Bitunix market-data envelopes instead of returning an empty market list", async () => {
  const client = createBitunixFuturesMarketDataClient({
    fetchImpl: async () => createResponse({ code: 0, data: null }),
  })

  await assert.rejects(
    () => client.getBitunixFuturesMarkets(),
    /invalid trading-pairs response/,
    "A malformed contracts response must be surfaced as an upstream failure rather than a successful empty screener.",
  )
})

test("rejects non-HTTPS Bitunix market-data origins and invalid timeout settings before making requests", () => {
  assert.throws(
    () => createBitunixFuturesMarketDataClient({ baseUrl: "http://fapi.bitunix.com" }),
    /HTTPS/,
    "Public exchange market data must never be requested over plaintext HTTP.",
  )
  assert.throws(
    () => createBitunixFuturesMarketDataClient({ timeoutMs: 0 }),
    /timeout/,
    "The upstream request timeout must be bounded and positive.",
  )
})
