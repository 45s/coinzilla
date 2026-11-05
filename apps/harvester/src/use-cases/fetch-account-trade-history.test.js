import assert from "node:assert/strict"
import test from "node:test"
import { Asset, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { fetchAccountTradeHistory } from "./fetch-account-trade-history.js"

const baseAsset = new Asset({ id: "btc", code: "BTC" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "BTCUSDT", baseAsset, quoteAsset })
const otherMarket = new Market({
  venue: "binance",
  symbol: "ETHUSDT",
  baseAsset: new Asset({ id: "eth", code: "ETH" }),
  quoteAsset,
})

const makeFill = ({ market: fillMarket = market, tradeId, executedAt = 100 } = {}) => new Fill({
  tradeId: String(tradeId),
  brokerOrderId: "9001",
  market: fillMarket,
  side: "BUY",
  price: new Money({ amount: "100", asset: fillMarket.quoteAsset }),
  quantity: new Quantity({ amount: "0.1", asset: fillMarket.baseAsset }),
  quoteQuantity: new Money({ amount: "10", asset: fillMarket.quoteAsset }),
  liquidityRole: "MAKER",
  executedAt,
  commissions: [],
  commissionStatus: "COMPLETE",
})

test("paginates each market from the durable baseline with strictly advancing trade IDs", async () => {
  const fills = [makeFill({ tradeId: 1 }), makeFill({ tradeId: 2 }), makeFill({ tradeId: 3 })]
  const calls = []
  const sleeps = []
  const broker = {
    getFills: async (query) => {
      calls.push(query)
      if (query.fromId === undefined) return { ok: true, data: fills.slice(0, 2) }
      if (query.fromId === 3) return { ok: true, data: fills.slice(2) }
      return { ok: true, data: [] }
    },
  }

  const result = await fetchAccountTradeHistory({
    broker,
    markets: [market],
    startTime: 50,
    limit: 2,
    requestDelayMs: 5,
    sleep: async (input) => sleeps.push(input),
    marketUniverseComplete: true,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.fills, fills)
  assert.equal(result.data.marketsChecked, 1)
  assert.equal(result.data.pagesChecked, 2)
  assert.equal(result.data.historyPagesComplete, true)
  assert.equal(result.data.marketUniverseComplete, true)
  assert.equal(result.data.complete, true)
  assert.deepEqual(calls, [
    { symbol: "BTCUSDT", limit: 2, startTime: 50 },
    { symbol: "BTCUSDT", limit: 2, fromId: 3 },
  ])
  assert.deepEqual(sleeps, [{ durationMs: 5 }])
})

test("enumerates every supplied market and does not claim the universe is complete by default", async () => {
  const calls = []
  const broker = {
    getFills: async (query) => {
      calls.push(query)
      return { ok: true, data: [] }
    },
  }
  const result = await fetchAccountTradeHistory({
    broker,
    markets: [market, otherMarket],
    startTime: 50,
    requestDelayMs: 0,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.marketsChecked, 2)
  assert.equal(result.data.complete, false)
  assert.deepEqual(calls, [
    { symbol: "BTCUSDT", limit: 1000, startTime: 50 },
    { symbol: "ETHUSDT", limit: 1000, startTime: 50 },
  ])
})

test("fails closed when a history page request fails", async () => {
  const result = await fetchAccountTradeHistory({
    broker: { getFills: async () => ({ ok: false, errors: [new Error("history unavailable")] }) },
    markets: [market],
    startTime: 50,
    requestDelayMs: 0,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /Unable to fetch complete account trade history/)
})

test("rejects non-canonical, wrong-market, and duplicate fill records", async () => {
  const invalid = await fetchAccountTradeHistory({
    broker: { getFills: async () => ({ ok: true, data: [{}] }) },
    markets: [market],
    startTime: 50,
    requestDelayMs: 0,
  })
  assert.equal(invalid.ok, false)
  assert.match(invalid.errors[0].message, /non-canonical or wrong-market/)

  const wrongMarket = await fetchAccountTradeHistory({
    broker: { getFills: async () => ({ ok: true, data: [makeFill({ market: otherMarket, tradeId: 1 })] }) },
    markets: [market],
    startTime: 50,
    requestDelayMs: 0,
  })
  assert.equal(wrongMarket.ok, false)

  const duplicate = makeFill({ tradeId: 1 })
  const duplicateResult = await fetchAccountTradeHistory({
    broker: { getFills: async () => ({ ok: true, data: [duplicate, duplicate] }) },
    markets: [market],
    startTime: 50,
    limit: 2,
    requestDelayMs: 0,
  })
  assert.equal(duplicateResult.ok, false)
  assert.match(duplicateResult.errors[0].message, /duplicate execution identity/)
})

test("rejects non-advancing cursors, backward timestamps, and unsafe pagination IDs", async () => {
  const repeatedCursor = await fetchAccountTradeHistory({
    broker: {
      getFills: async ({ fromId }) => ({
        ok: true,
        data: [makeFill({ tradeId: fromId === undefined ? 2 : 2 })],
      }),
    },
    markets: [market],
    startTime: 50,
    limit: 1,
    requestDelayMs: 0,
  })
  assert.equal(repeatedCursor.ok, false)
  assert.match(repeatedCursor.errors[0].message, /cursor did not advance/)

  const backwards = await fetchAccountTradeHistory({
    broker: {
      getFills: async () => ({
        ok: true,
        data: [makeFill({ tradeId: 1, executedAt: 200 }), makeFill({ tradeId: 2, executedAt: 100 })],
      }),
    },
    markets: [market],
    startTime: 50,
    limit: 2,
    requestDelayMs: 0,
  })
  assert.equal(backwards.ok, false)
  assert.match(backwards.errors[0].message, /timestamps are invalid or moved backwards/)

  const unsafe = await fetchAccountTradeHistory({
    broker: {
      getFills: async () => ({
        ok: true,
        data: [makeFill({ tradeId: Number.MAX_SAFE_INTEGER })],
      }),
    },
    markets: [market],
    startTime: 50,
    limit: 1,
    requestDelayMs: 0,
  })
  assert.equal(unsafe.ok, false)
  assert.match(unsafe.errors[0].message, /cannot safely advance/)
})

test("rejects a baseline after an exchange execution timestamp", async () => {
  const result = await fetchAccountTradeHistory({
    broker: { getFills: async () => ({ ok: true, data: [makeFill({ tradeId: 1, executedAt: 49 })] }) },
    markets: [market],
    startTime: 50,
    requestDelayMs: 0,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /before the requested baseline/)
})
