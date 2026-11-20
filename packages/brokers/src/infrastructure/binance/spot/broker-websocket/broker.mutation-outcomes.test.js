import assert from "node:assert/strict"
import test from "node:test"

import { BinanceWebSocketBroker } from "./broker.js"

const ORDER_RESPONSE = {
  origQty: "1.00000000",
  executedQty: "0.00000000",
  price: "100.00000000",
  orderId: 123,
  clientOrderId: "client-123",
  type: "LIMIT",
  side: "BUY",
  symbol: "BTCUSDT",
  status: "NEW",
}

function createBroker({ request }) {
  return new BinanceWebSocketBroker({
    apiKey: "mutation-test-key",
    apiSecret: "mutation-test-secret",
    tradingMode: "testnet",
  }, {
    apiClientFactory: () => ({
      async request(...args) {
        return request(...args)
      },
      async connect() {},
      async disconnect() {},
    }),
    marketClientFactory: () => ({
      async disconnect() {},
      async subscribe() {},
      async unsubscribe() {},
    }),
    logger: {
      error() {},
      warn() {},
      info() {},
    },
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
  })
}

const orderInput = {
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  quantity: "1.00000000",
  price: "100.00000000",
  clientOrderId: "client-123",
}

test("Binance createOrder reports CONFIRMED after an authoritative success response", async () => {
  const broker = createBroker({
    request: async () => ({ data: ORDER_RESPONSE }),
  })

  const result = await broker.createOrder(orderInput)

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
})

test("Binance createOrder distinguishes definitive rejection from unknown outcome", async () => {
  const rejectedBroker = createBroker({
    request: async () => {
      throw Object.assign(new Error("exchange rejected request"), {
        status: 400,
        outcomeUnknown: false,
      })
    },
  })
  const unknownBroker = createBroker({
    request: async () => {
      throw Object.assign(new Error("exchange response was lost"), {
        status: 503,
        outcomeUnknown: true,
      })
    },
  })

  const rejected = await rejectedBroker.createOrder(orderInput)
  const unknown = await unknownBroker.createOrder(orderInput)

  assert.equal(rejected.ok, false)
  assert.equal(rejected.mutationOutcome, "REJECTED")
  assert.equal(unknown.ok, false)
  assert.equal(unknown.mutationOutcome, "OUTCOME_UNKNOWN")
})

test("Binance cancelOrder reports a local guard as NOT_SENT", async () => {
  const broker = createBroker({
    request: async () => ({ data: ORDER_RESPONSE }),
  })
  broker.userDataUnavailable = true

  const result = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: 123,
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.cancellationOutcome, "NOT_SENT")
})
test("Binance dispatched canonical order mutations report an unknown outcome on transport loss", async () => {
  const broker = createBroker({
    request: async () => {
      throw new Error("exchange response was lost")
    },
  })

  const results = await Promise.all([
    broker.createCanonicalOrder(orderInput),
    broker.cancelOrder({
      symbol: "BTCUSDT",
      orderId: 123,
    }),
    broker.cancelAllOpenOrders({
      symbol: "BTCUSDT",
    }),
  ])

  for (const result of results) {
    assert.equal(result.ok, false)
    assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN")
  }
})

test("Binance canonical order local validation failures remain NOT_SENT", async () => {
  let dispatched = false
  const broker = createBroker({
    request: async () => {
      dispatched = true
      return { data: ORDER_RESPONSE }
    },
  })

  const result = await broker.createCanonicalOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: "1.00000000",
    price: "100.00000000",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(dispatched, false)
})
