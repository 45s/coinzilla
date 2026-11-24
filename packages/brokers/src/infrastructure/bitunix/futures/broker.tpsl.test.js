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

  assert.equal(result.ok, true)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].id, "tpsl-1")
  assert.equal(result.data[0].tpPrice, "70000.00000001")
  assert.equal(result.data[0].slPrice, "65000.00000002")
  assert.equal(result.data[0].status, "TRIGGERED")
  assert.equal(result.data[0].ctime, 1_700_000_000_000)
  assert.equal(result.data[0].triggerTime, 1_700_000_001_000)

  const url = new URL(requests[0].url)
  assert.equal(url.pathname, "/api/v1/futures/tpsl/get_history_orders")
  assert.equal(url.searchParams.get("symbol"), "BTCUSDT")
  assert.equal(url.searchParams.get("side"), "1")
  assert.equal(url.searchParams.get("positionMode"), "2")
  assert.equal(url.searchParams.get("startTime"), "1700000000000")
  assert.equal(url.searchParams.get("endTime"), "1700000100000")
  assert.equal(url.searchParams.get("limit"), "50")
  assert.equal(url.searchParams.get("skip"), "10")
})
