import assert from "node:assert/strict"
import test from "node:test"

import { BinanceSdkBroker } from "./broker.js"

const logger = {
  debug() {},
  error() {},
  info() {},
  warn() {},
}

function createBroker(connection = {}) {
  const broker = Object.create(BinanceSdkBroker.prototype)
  broker.logger = logger
  broker.tradingConnection = connection
  return broker
}

const exchangeOrder = {
  symbol: "BTCUSDT",
  orderId: 42,
  clientOrderId: "client-42",
  type: "LIMIT",
  side: "BUY",
  price: "65000.10",
  origQty: "0.25000000",
  executedQty: "0.05000000",
  status: "PARTIALLY_FILLED",
}

test("getAssets returns non-zero free plus locked balances as Coin values", async () => {
  const broker = createBroker({
    accountStatus: async (params) => {
      assert.deepEqual(params, { omitZeroBalances: true })
      return {
        data: {
          balances: [
            { asset: "BTC", free: "0.25", locked: "0.05" },
            { asset: "USDT", free: "0", locked: "0" },
          ],
        },
      }
    },
  })

  const result = await broker.getAssets()

  assert.deepEqual(result, {
    ok: true,
    data: [{ ticker: "BTC", quantity: 0.3 }],
  })
})

test("getOpenOrders maps exchange orders and supports an optional symbol", async () => {
  const requests = []
  const broker = createBroker({
    openOrdersStatus: async (params) => {
      requests.push(params)
      return { data: [exchangeOrder] }
    },
  })

  const allOrders = await broker.getOpenOrders()
  const symbolOrders = await broker.getOpenOrders({ symbol: "BTCUSDT" })

  assert.deepEqual(requests, [{}, { symbol: "BTCUSDT" }])
  assert.equal(allOrders.ok, true)
  assert.equal(allOrders.data[0].id, "42")
  assert.equal(allOrders.data[0].quantity, 0.2)
  assert.equal(allOrders.data[0].originalQuantity, "0.25000000")
  assert.equal(allOrders.data[0].executedQuantity, "0.05000000")
  assert.equal(allOrders.data[0].status, "PARTIALLY_FILLED")
  assert.equal(symbolOrders.ok, true)
})

test("getOrder and cancelOrder return the normalized order contract", async () => {
  const requests = []
  const broker = createBroker({
    orderStatus: async (params) => {
      requests.push(["status", params])
      return { data: exchangeOrder }
    },
    orderCancel: async (params) => {
      requests.push(["cancel", params])
      return { data: { ...exchangeOrder, status: "CANCELED" } }
    },
  })

  const current = await broker.getOrder({ symbol: "BTCUSDT", orderId: 42 })
  const canceled = await broker.cancelOrder({ symbol: "BTCUSDT", orderId: 42 })

  assert.deepEqual(requests, [
    ["status", { symbol: "BTCUSDT", orderId: 42 }],
    ["cancel", { symbol: "BTCUSDT", orderId: 42 }],
  ])
  assert.equal(current.ok, true)
  assert.equal(current.data.id, "42")
  assert.equal(current.data.quantity, 0.2)
  assert.equal(canceled.ok, true)
  assert.equal(canceled.data.status, "CANCELED")
})

test("cancelAllOpenOrders normalizes every returned order", async () => {
  let request
  const broker = createBroker({
    openOrdersCancelAll: async (params) => {
      request = params
      return { data: [exchangeOrder, { ...exchangeOrder, orderId: 43 }] }
    },
  })

  const result = await broker.cancelAllOpenOrders({ symbol: "BTCUSDT" })

  assert.deepEqual(request, { symbol: "BTCUSDT" })
  assert.equal(result.ok, true)
  assert.deepEqual(result.data.map((order) => order.id), ["42", "43"])
})

test("getPrices passes through the exchange ticker response", async () => {
  const ticker = { symbol: "BTCUSDT", price: "65000.10" }
  const broker = createBroker({
    tickerPrice: async (params) => {
      assert.deepEqual(params, { symbol: "BTCUSDT" })
      return { data: ticker }
    },
  })

  assert.deepEqual(await broker.getPrices({ symbol: "BTCUSDT" }), {
    ok: true,
    data: ticker,
  })
})

test("connect opens WebSocket API before market-data Streams and retains both handles", async () => {
  const calls = []
  const tradingConnection = { disconnect: async () => {} }
  const marketConnection = { disconnect: async () => {} }
  const broker = createBroker()
  broker.client = {
    websocketAPI: {
      connect: async () => {
        calls.push("api")
        return tradingConnection
      },
    },
    websocketStreams: {
      connect: async () => {
        calls.push("streams")
        return marketConnection
      },
    },
  }

  await broker.connect()

  assert.deepEqual(calls, ["api", "streams"])
  assert.equal(broker.tradingConnection, tradingConnection)
  assert.equal(broker.marketConnection, marketConnection)
})
