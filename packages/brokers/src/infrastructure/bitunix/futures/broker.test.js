import assert from "node:assert/strict"
import test from "node:test"

import { BitunixFuturesBroker } from "./broker.js"
import { BitunixFuturesConfig } from "./config.js"

function createBroker({ responses = {} } = {}) {
  const calls = []
  const restClient = {
    async request(request) {
      calls.push(request)
      return {
        data: responses[request.path] ?? [],
      }
    },
  }
  const config = new BitunixFuturesConfig({
    apiKey: "api-key",
    apiSecret: "api-secret",
  })

  return {
    broker: new BitunixFuturesBroker({ config,
      restClient }),
    calls,
  }
}

test("getTradingPairs uses the documented public trading-pairs endpoint", async () => {
  const { broker,
    calls } = createBroker({
    responses: {
      "/api/v1/futures/market/trading_pairs": [{
        symbol: "BTCUSDT",
        base: "BTC",
        quote: "USDT",
        minTradeVolume: "0.0001",
        basePrecision: 4,
        quotePrecision: 1,
        maxLeverage: 125,
        minLeverage: 1,
        defaultLeverage: 20,
        symbolStatus: "OPEN",
        isApiSupported: true,
      }],
    },
  })

  const result = await broker.getTradingPairs({ symbols: ["BTCUSDT", "ETHUSDT"] })

  assert.equal(result.ok, true)
  assert.equal(result.data[0].symbol, "BTCUSDT")
  assert.deepEqual(calls[0], {
    method: "GET",
    path: "/api/v1/futures/market/trading_pairs",
    queryParams: { symbols: "BTCUSDT,ETHUSDT" },
    authenticated: false,
    stateChanging: false,
  })
})

test("getTickers uses the documented public ticker endpoint and preserves decimal strings", async () => {
  const { broker,
    calls } = createBroker({
    responses: {
      "/api/v1/futures/market/tickers": [{
        symbol: "BTCUSDT",
        markPrice: "60000.00000001",
        lastPrice: "60000.00000002",
        open: "59000",
        last: "60000",
        quoteVol: "10.25",
        baseVol: "0.5",
        high: "61000",
        low: "58000",
      }],
    },
  })

  const result = await broker.getTickers({ symbols: ["BTCUSDT"] })

  assert.equal(result.ok, true)
  assert.equal(result.data[0].markPrice, "60000.00000001")
  assert.deepEqual(calls[0], {
    method: "GET",
    path: "/api/v1/futures/market/tickers",
    queryParams: { symbols: "BTCUSDT" },
    authenticated: false,
    stateChanging: false,
  })
})

test("getDepth validates the documented fixed-depth values", async () => {
  const { broker,
    calls } = createBroker({
    responses: {
      "/api/v1/futures/market/depth": {
        asks: [["60001.25", "1.00000001"]],
        bids: [["60000.75", "2.00000002"]],
      },
    },
  })

  const result = await broker.getDepth({ symbol: "BTCUSDT",
    limit: "max" })

  assert.equal(result.ok, true)
  assert.equal(result.data.asks[0][0], "60001.25")
  assert.equal(result.data.bids[0][1], "2.00000002")
  assert.deepEqual(calls[0], {
    method: "GET",
    path: "/api/v1/futures/market/depth",
    queryParams: { symbol: "BTCUSDT",
      limit: "max" },
    authenticated: false,
    stateChanging: false,
  })
})

test("getKlines preserves exclusive endTime and the documented 200-candle maximum", async () => {
  const { broker,
    calls } = createBroker({
    responses: {
      "/api/v1/futures/market/kline": [{
        open: "60000.1",
        high: "60001.2",
        low: "59999.8",
        close: "60000.9",
        quoteVol: "10.00000001",
        baseVol: "0.00016666",
        time: "1772449200000",
        type: "MARK_PRICE",
      }],
    },
  })

  const result = await broker.getKlines({
    symbol: "BTCUSDT",
    interval: "15m",
    endTime: "1772450100000",
    limit: 200,
    type: "MARK_PRICE",
  })

  assert.equal(result.ok, true)
  assert.equal(result.data[0].time, "1772449200000")
  assert.deepEqual(calls[0], {
    method: "GET",
    path: "/api/v1/futures/market/kline",
    queryParams: {
      symbol: "BTCUSDT",
      interval: "15m",
      endTime: "1772450100000",
      limit: 200,
      type: "MARK_PRICE",
    },
    authenticated: false,
    stateChanging: false,
  })
})

test("getFundingRate and getFundingRates use the current and batch public endpoints", async () => {
  const { broker,
    calls } = createBroker({
    responses: {
      "/api/v1/futures/market/funding_rate": [{
        symbol: "BTCUSDT",
        markPrice: "60000.1",
        lastPrice: "60000.2",
        indexPrice: "60000.3",
        fundingRate: "0.0005",
        nextFundingTime: "1770710400000",
        fundingInterval: 8,
        maxFundingRate: "0.3",
        minFundingRate: "-0.3",
      }],
      "/api/v1/futures/market/funding_rate/batch": [],
    },
  })

  const current = await broker.getFundingRate({ symbol: "BTCUSDT" })
  const batch = await broker.getFundingRates()

  assert.equal(current.ok, true)
  assert.equal(current.data[0].indexPrice, "60000.3")
  assert.equal(current.data[0].nextFundingTime, "1770710400000")
  assert.equal(batch.ok, true)
  assert.deepEqual(calls.map(({ path,
    authenticated }) => ({ path,
    authenticated })), [
    { path: "/api/v1/futures/market/funding_rate",
      authenticated: false },
    { path: "/api/v1/futures/market/funding_rate/batch",
      authenticated: false },
  ])
})

test("getFundingRateHistory preserves funding settlement timestamps and validates the limit", async () => {
  const { broker,
    calls } = createBroker({
    responses: {
      "/api/v1/futures/market/get_funding_rate_history": [{
        fundingRate: "-0.00001191",
        fundingTime: "1772449200000",
        markPrice: "66286.6",
      }],
    },
  })

  const result = await broker.getFundingRateHistory({
    symbol: "BTCUSDT",
    startTime: "1772440000000",
    endTime: "1772450000000",
    limit: 200,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data[0].fundingTime, "1772449200000")
  assert.deepEqual(calls[0].queryParams, {
    symbol: "BTCUSDT",
    startTime: "1772440000000",
    endTime: "1772450000000",
    limit: 200,
  })
})

test("private position and order reads use authenticated GET requests", async () => {
  const { broker,
    calls } = createBroker({
    responses: {
      "/api/v1/futures/account": [{
        marginCoin: "USDT",
        available: "1000",
        frozen: "0",
        margin: "10",
        transfer: "1000",
        positionMode: "HEDGE",
        crossUnrealizedPNL: "2",
        isolationUnrealizedPNL: "0",
        bonus: "0",
      }],
      "/api/v1/futures/position/get_pending_positions": [],
      "/api/v1/futures/trade/get_pending_orders": { orderList: [],
        total: "0" },
    },
  })

  const account = await broker.getAccount({ marginCoin: "USDT" })
  const positions = await broker.getPendingPositions({ symbol: "BTCUSDT" })
  const orders = await broker.getPendingOrders({ symbol: "BTCUSDT",
    limit: 100 })

  assert.equal(account.ok, true)
  assert.equal(account.data[0].available, "1000")
  assert.equal(positions.ok, true)
  assert.equal(orders.ok, true)
  assert.deepEqual(calls.map(({ path,
    authenticated,
    stateChanging }) => ({
    path,
    authenticated,
    stateChanging,
  })), [
    { path: "/api/v1/futures/account",
      authenticated: true,
      stateChanging: false },
    { path: "/api/v1/futures/position/get_pending_positions",
      authenticated: true,
      stateChanging: false },
    { path: "/api/v1/futures/trade/get_pending_orders",
      authenticated: true,
      stateChanging: false },
  ])
})

test("invalid Kline and pagination requests fail before reaching the REST client", async () => {
  const { broker,
    calls } = createBroker()

  const invalidInterval = await broker.getKlines({
    symbol: "BTCUSDT",
    interval: "2m",
  })
  const oversizedKlines = await broker.getKlines({
    symbol: "BTCUSDT",
    interval: "1m",
    limit: 201,
  })
  const oversizedOrders = await broker.getPendingOrders({ limit: 101 })

  assert.equal(invalidInterval.ok, false)
  assert.equal(oversizedKlines.ok, false)
  assert.equal(oversizedOrders.ok, false)
  assert.equal(calls.length, 0)
})
