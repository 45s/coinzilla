import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"

const credentials = {
  apiKey: "bitunix-futures-pending-orders-test-key",
  apiSecret: "bitunix-futures-pending-orders-test-secret",
}

const pendingOrder = {
  orderId: "pending-123",
  symbol: "BTCUSDT",
  qty: "0.5",
  tradeQty: "0.125",
  positionMode: "HEDGE",
  marginMode: "ISOLATION",
  leverage: 10,
  price: "65000.123456789012345",
  side: "BUY",
  orderType: "LIMIT",
  effect: "GTC",
  clientId: "strategy-order-123",
  reduceOnly: false,
  status: "PART_FILLED",
  fee: "0.01",
  realizedPNL: "-0.25",
  ctime: 1_700_000_000_000,
  mtime: 1_700_000_001_000,
}

function createBroker({ rows = [pendingOrder], total = rows.length } = {}) {
  const requests = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        fetchFn: async (url, options) => {
          requests.push({ url: String(url), options })
          return {
            ok: true,
            status: 200,
            json: async () => ({
              code: 0,
              data: { orderList: rows, total },
            }),
          }
        },
      },
    },
  })
  return { broker, requests }
}

test("Bitunix Futures pending-order read preserves exact values and explicit pagination", async () => {
  const { broker, requests } = createBroker()
  const result = await broker.getFuturesPendingOrders({
    symbol: "btcusdt",
    status: "PART_FILLED",
    startTime: 1_699_999_000_000,
    endTime: 1_700_001_000_000,
    limit: 50,
    skip: 100,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.total, 1)
  assert.deepEqual(result.data.orders[0], {
    orderId: "pending-123",
    symbol: "BTCUSDT",
    quantity: "0.5",
    executedQuantity: "0.125",
    positionMode: "HEDGE",
    marginMode: "ISOLATION",
    leverage: 10,
    price: "65000.123456789012345",
    side: "BUY",
    orderType: "LIMIT",
    effect: "GTC",
    clientId: "strategy-order-123",
    reduceOnly: false,
    status: "PART_FILLED",
    fee: "0.01",
    realizedPNL: "-0.25",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
  })
  const query = new URL(requests[0].url).searchParams
  assert.equal(new URL(requests[0].url).pathname, "/api/v1/futures/trade/get_pending_orders")
  assert.equal(query.get("symbol"), "BTCUSDT")
  assert.equal(query.get("status"), "PART_FILLED")
  assert.equal(query.get("startTime"), "1699999000000")
  assert.equal(query.get("endTime"), "1700001000000")
  assert.equal(query.get("limit"), "50")
  assert.equal(query.get("skip"), "100")
})

test("Bitunix Futures pending-order read permits market orders without an undocumented price", async () => {
  const { broker } = createBroker({
    rows: [{
      ...pendingOrder,
      orderType: "MARKET",
      price: undefined,
      status: "NEW",
      tradeQty: "0",
    }],
  })
  const result = await broker.getFuturesPendingOrders({ symbol: "BTCUSDT" })
  assert.equal(result.ok, true)
  assert.equal(result.data.orders[0].price, undefined)
})

test("Bitunix Futures pending-order read rejects malformed quantities and pagination", async () => {
  const { broker, requests } = createBroker({
    rows: [{ ...pendingOrder, tradeQty: "0.6" }],
  })
  const malformed = await broker.getFuturesPendingOrders({ symbol: "BTCUSDT" })
  assert.equal(malformed.ok, false)

  const invalidLimit = await broker.getFuturesPendingOrders({
    symbol: "BTCUSDT",
    limit: 101,
  })
  assert.equal(invalidLimit.ok, false)
  assert.equal(requests.length, 1)
})
