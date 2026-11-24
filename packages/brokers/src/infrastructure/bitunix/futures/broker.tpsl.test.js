import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"

const credentials = {
  apiKey: "bitunix-futures-tpsl-test-key",
  apiSecret: "bitunix-futures-tpsl-test-secret",
}

const tpSlRow = {
  id: "tpsl-1",
  positionId: "position-1",
  symbol: "BTCUSDT",
  base: "BTC",
  quote: "USDT",
  tpPrice: "70000.00000001",
  tpStopType: "MARK_PRICE",
  slPrice: "65000.00000002",
  slStopType: "LAST_PRICE",
  tpOrderType: "LIMIT",
  tpOrderPrice: "70010.00000003",
  slOrderType: "MARKET",
  tpQty: "0.01000001",
  slQty: "0.01000002",
}

function createBroker({ rows = [tpSlRow], responseData } = {}) {
  const requests = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        fetchFn: async (...args) => {
          const [url, options] = args
          requests.push({
            url: String(url),
            options,
          })
          return {
            ok: true,
            status: 200,
            json: async () => ({
              code: 0,
              data: responseData ?? rows,
            }),
          }
        },
      },
    },
  })
  return {
    broker,
    requests,
  }
}

test("Bitunix Futures pending TP/SL reads preserve exact trigger and execution values", async () => {
  const { broker, requests } = createBroker()
  const result = await broker.getFuturesPendingTpSlOrders({
    symbol: "BTCUSDT",
    positionId: "position-1",
    limit: 50,
    skip: 10,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].tpPrice, "70000.00000001")
  assert.equal(result.data[0].tpOrderPrice, "70010.00000003")
  assert.equal(result.data[0].tpQty, "0.01000001")
  assert.equal(result.data[0].slQty, "0.01000002")
  const url = new URL(requests[0].url)
  assert.equal(url.pathname, "/api/v1/futures/tpsl/get_pending_orders")
  assert.equal(url.searchParams.get("symbol"), "BTCUSDT")
  assert.equal(url.searchParams.get("positionId"), "position-1")
  assert.equal(url.searchParams.get("limit"), "50")
  assert.equal(url.searchParams.get("skip"), "10")
})

test("Bitunix Futures pending TP/SL reads accept a single stop leg", async () => {
  const { broker } = createBroker({
    rows: [{
      id: "tpsl-stop-only",
      positionId: "position-1",
      symbol: "BTCUSDT",
      base: "BTC",
      quote: "USDT",
      slPrice: "65000",
      slStopType: "LAST_PRICE",
      slOrderType: "MARKET",
      slQty: "0.01",
    }],
  })
  const result = await broker.getFuturesPendingTpSlOrders()

  assert.equal(result.ok, true)
  assert.equal(result.data[0].slQty, "0.01")
  assert.equal(result.data[0].tpQty, undefined)
})

test("Bitunix Futures pending TP/SL reads reject incomplete LIMIT legs", async () => {
  const { broker } = createBroker({
    rows: [{
      ...tpSlRow,
      tpOrderPrice: undefined,
    }],
  })
  const result = await broker.getFuturesPendingTpSlOrders()

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /tpOrderPrice/i)
})

test("Bitunix Futures pending TP/SL reads reject pages above the documented maximum", async () => {
  const { broker, requests } = createBroker()
  const result = await broker.getFuturesPendingTpSlOrders({
    limit: 101,
  })

  assert.equal(result.ok, false)
  assert.equal(requests.length, 0)
})


test("Bitunix Futures TP/SL history reads preserve exchange history fields and pagination", async () => {
  const historyRow = {
    ...tpSlRow,
    status: "TRIGGERED",
    ctime: 1_700_000_000_000,
    triggerTime: 1_700_000_001_000,
  }
  const { broker, requests } = createBroker({
    responseData: {
      orderList: [historyRow],
      total: 1,
    },
  })
  const result = await broker.getFuturesTpSlOrderHistory({
    symbol: "BTCUSDT",
    side: 1,
    positionMode: 2,
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_100_000,
    limit: 50,
    skip: 10,
  })

  assert.equal(result.ok, true, "A valid historical TP/SL page must be returned successfully")
  assert.equal(result.data.orders.length, 1, "The documented orderList must be exposed as one historical TP/SL order")
  assert.equal(result.data.orders[0].id, "tpsl-1", "The exchange TP/SL order identity must be preserved")
  assert.equal(result.data.orders[0].tpPrice, "70000.00000001", "The exact take-profit trigger price must not be rounded")
  assert.equal(result.data.orders[0].slPrice, "65000.00000002", "The exact stop-loss trigger price must not be rounded")
  assert.equal(result.data.orders[0].status, "TRIGGERED", "The exchange TP/SL lifecycle status must be preserved")
  assert.equal(result.data.orders[0].ctime, 1_700_000_000_000, "The exchange creation timestamp must be preserved")
  assert.equal(result.data.orders[0].triggerTime, 1_700_000_001_000, "The exchange trigger timestamp must be preserved")
  assert.equal(result.data.total, 1, "The exchange total must remain distinct from the current page length")
  assert.equal(result.data.skip, 10, "The requested history offset must be returned unchanged")
  assert.equal(result.data.limit, 50, "The requested history page size must be returned unchanged")

  const url = new URL(requests[0].url)
  assert.equal(url.pathname, "/api/v1/futures/tpsl/get_history_orders", "TP/SL history must use the dedicated Futures history endpoint")
  assert.equal(url.searchParams.get("symbol"), "BTCUSDT", "The requested Futures symbol must be sent unchanged after normalization")
  assert.equal(url.searchParams.get("side"), "1", "The requested trade side filter must reach the exchange")
  assert.equal(url.searchParams.get("positionMode"), "2", "The requested position mode filter must reach the exchange")
  assert.equal(url.searchParams.get("startTime"), "1700000000000", "The requested history start timestamp must reach the exchange")
  assert.equal(url.searchParams.get("endTime"), "1700000100000", "The requested history end timestamp must reach the exchange")
  assert.equal(url.searchParams.get("limit"), "50", "The bounded page limit must reach the exchange")
  assert.equal(url.searchParams.get("skip"), "10", "The page offset must reach the exchange")
})

test("Bitunix Futures TP/SL history rejects an oversized page before dispatch", async () => {
  const { broker, requests } = createBroker()
  const result = await broker.getFuturesTpSlOrderHistory({
    symbol: "BTCUSDT",
    limit: 101,
  })

  assert.equal(result.ok, false, "A history request above the documented 100-row maximum must fail validation")
  assert.equal(requests.length, 0, "Invalid TP/SL history pagination must be rejected before any exchange request")
})

test("Bitunix Futures TP/SL history rejects rows for a different requested symbol", async () => {
  const { broker, requests } = createBroker({
    responseData: {
      orderList: [{
        ...tpSlRow,
        symbol: "ETHUSDT",
      }],
      total: 1,
    },
  })
  const result = await broker.getFuturesTpSlOrderHistory({
    symbol: "BTCUSDT",
  })

  assert.equal(result.ok, false, "A TP/SL history row for another market must not be returned as the requested market")
  assert.equal(requests.length, 1, "The exchange response must be checked after the single requested history read")
})


test("Bitunix Futures TP/SL history rejects values outside the documented int32 query range", async () => {
  const { broker, requests } = createBroker({
    responseData: {
      orderList: [tpSlRow],
      total: 1,
    },
  })
  const result = await broker.getFuturesTpSlOrderHistory({
    side: 2_147_483_648,
  })

  assert.equal(result.ok, false, "An int32 query field outside the signed 32-bit range must be rejected")
  assert.equal(requests.length, 0, "Out-of-range TP/SL history filters must be rejected before dispatch")
})
