import assert from "node:assert/strict"
import test from "node:test"

import { startTradingHistoryApiServer } from "./trading-history-api.js"

function createTradingHistoryQueries() {
  return {
    getSummary: () => ({ ok: true, data: { orders: 0, fills: 0, commissions: 0 } }),
    listOrders: () => ({ ok: true, data: { items: [], pagination: { limit: 50, offset: 0, total: 0, hasMore: false } } }),
    getOrder: () => ({ ok: true, data: null }),
    listFills: () => ({ ok: true, data: { items: [], pagination: { limit: 50, offset: 0, total: 0, hasMore: false } } }),
    getFill: () => ({ ok: true, data: null }),
    listCommissions: () => ({ ok: true, data: { items: [], pagination: { limit: 50, offset: 0, total: 0, hasMore: false } } }),
  }
}

test("serves the Bitunix Futures public market snapshot through the local API", async (t) => {
  const snapshot = {
    provider: "bitunix",
    marketType: "futures",
    observedAt: "2026-11-21T12:00:00.000Z",
    markets: [{
      symbol: "BTCUSDT",
      base: "BTC",
      quote: "USDT",
      symbolStatus: "OPEN",
      lastPrice: "67000.10",
      markPrice: "67001.20",
      quoteVol: "123456.78",
      change24h: "1.25",
      change5m: null,
      change1h: null,
      change4h: null,
    }],
  }
  const marketData = {
    getBitunixFuturesMarkets: async () => snapshot,
  }
  const api = await startTradingHistoryApiServer({
    queries: createTradingHistoryQueries(),
    marketData,
    environment: "testnet",
    port: 0,
    logger: { error() {} },
  })
  t.after(async () => api.close())

  const response = await fetch(`http://127.0.0.1:${api.address.port}/api/v1/markets/bitunix/futures`, {
    headers: { Origin: "http://127.0.0.1:4200" },
  })

  assert.equal(response.status, 200, "The local market screener endpoint must return a public Bitunix Futures snapshot.")
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:4200", "The existing local Dashboard Origin allowlist must apply to market data.")
  assert.deepEqual((await response.json()).data, snapshot, "The API must pass through the native 24h percentage and preserve absent shorter-window percentages as null.")
})

test("returns a safe API error when the Bitunix Futures market-data provider fails", async (t) => {
  const api = await startTradingHistoryApiServer({
    queries: createTradingHistoryQueries(),
    marketData: {
      getBitunixFuturesMarkets: async () => {
        throw new Error("private upstream diagnostic must not leak")
      },
    },
    environment: "testnet",
    port: 0,
    logger: { error() {} },
  })
  t.after(async () => api.close())

  const response = await fetch(`http://127.0.0.1:${api.address.port}/api/v1/markets/bitunix/futures`)

  assert.equal(response.status, 502, "An unavailable upstream market-data provider must be represented as a bad gateway.")
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "HARVESTER_MARKET_DATA_UPSTREAM_UNAVAILABLE",
      message: "Public market data is temporarily unavailable.",
    },
  }, "The public API must return a stable safe error without exposing upstream details.")
})
