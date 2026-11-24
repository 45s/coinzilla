import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"
import { CanonicalOrder } from "@coinzilla/entities"

const credentials = {
  apiKey: "bitunix-futures-orders-test-key",
  apiSecret: "bitunix-futures-orders-test-secret",
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

function createOrderRow(overrides = {}) {
  return {
    orderId: "futures-order-123",
    clientId: "strategy-order-456",
    symbol: "BTCUSDT",
    qty: "0.500000000000000001",
    tradeQty: "0.125000000000000001",
    price: "65000.123456789012345",
    side: "BUY",
    orderType: "LIMIT",
    status: "PART_FILLED",
    positionMode: "HEDGE",
    marginMode: "ISOLATION",
    leverage: 10,
    reduceOnly: false,
    ctime: 1_700_000_000_000,
    mtime: 1_700_000_000_500,
    ...overrides,
  }
}

function createBroker({ orderRow = createOrderRow() } = {}) {
  const requests = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        fetchFn: async (url, options) => {
          requests.push({ url: String(url), options })
          const path = new URL(url).pathname
          if (path === "/api/v1/futures/market/trading_pairs") {
            return createFuturesResponse({
              data: [{
                symbol: "BTCUSDT",
                base: "BTC",
                quote: "USDT",
                symbolStatus: "OPEN",
                isApiSupported: true,
              }],
            })
          }
          if (path === "/api/v1/futures/trade/get_order_detail") {
            return createFuturesResponse({ data: orderRow })
          }
          if (path === "/api/v1/futures/trade/get_history_orders") {
            return createFuturesResponse({
              data: {
                orderList: [orderRow],
                total: 1,
              },
            })
          }
          throw new Error(`Unexpected Futures request: ${path}`)
        },
      },
    },
  })
  return { broker, requests }
}

test("Bitunix Futures getCanonicalOrder reads by client ID and preserves exact order facts", async () => {
  const { broker, requests } = createBroker()
  await broker.getExchangeMarkets()

  const result = await broker.getCanonicalOrder({
    symbol: "BTCUSDT",
    clientOrderId: "strategy-order-456",
  })

  assert.equal(result.ok, true)
  assert.ok(result.data instanceof CanonicalOrder)
  assert.equal(result.data.clientOrderId, "strategy-order-456")
  assert.equal(result.data.brokerOrderId, "futures-order-123")
  assert.equal(result.data.market.symbol, "BTCUSDT")
  assert.equal(result.data.side, "BUY")
  assert.equal(result.data.type, "LIMIT")
  assert.equal(result.data.status, "PARTIALLY_FILLED")
  assert.equal(result.data.originalQuantity.amount, "0.500000000000000001")
  assert.equal(result.data.executedQuantity.amount, "0.125000000000000001")
  assert.equal(result.data.remainingQuantity.amount, "0.375")
  assert.equal(result.data.limitPrice.amount, "65000.123456789012345")
  assert.equal(result.data.createdAt, 1_700_000_000_000)
  assert.equal(result.data.updatedAt, 1_700_000_000_500)

  const detailRequest = requests.find(({ url }) => new URL(url).pathname === "/api/v1/futures/trade/get_order_detail")
  assert.ok(detailRequest)
  assert.equal(new URL(detailRequest.url).searchParams.get("clientId"), "strategy-order-456")
  assert.equal(new URL(detailRequest.url).searchParams.has("orderId"), false)
  assert.equal(detailRequest.options.method, "GET")
  assert.equal(Object.hasOwn(detailRequest.options.headers, "api-key"), true)
})

test("Bitunix Futures getCanonicalOrder rejects exchange rows without a client ID instead of inventing canonical identity", async () => {
  const { broker } = createBroker({
    orderRow: createOrderRow({ clientId: undefined }),
  })
  await broker.getExchangeMarkets()

  const result = await broker.getCanonicalOrder({
    symbol: "BTCUSDT",
    orderId: "futures-order-123",
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /client.*id/i)
})

test("Bitunix Futures canonical order lookup requires exactly one identifier", async () => {
  const { broker, requests } = createBroker()

  const result = await broker.getCanonicalOrder({
    symbol: "BTCUSDT",
    orderId: "futures-order-123",
    clientOrderId: "strategy-order-456",
  })

  assert.equal(result.ok, false)
  assert.equal(requests.length, 0)
})
