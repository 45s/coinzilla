import test from "node:test"
import assert from "node:assert/strict"
import { CanonicalOrder } from "@coinzilla/entities"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeRpcClient } from "../test-helpers/fake-broker-clients.js"

function createBroker({ orderResponse, exchangeInfo } = {}) {
  const rpc = createFakeRpcClient({
    "order.place": () => orderResponse,
    exchangeInfo: () => exchangeInfo ?? { symbols: [{
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      orderTypes: ["LIMIT", "LIMIT_MAKER"],
      filters: [
        { filterType: "PRICE_FILTER", tickSize: "0.01" },
        { filterType: "LOT_SIZE", stepSize: "0.00001" },
      ],
    }] },
  })
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {}, debug() {}, warn() {} },
  })
  broker.tradingConnection = rpc
  broker.connected = true
  return { broker, rpc }
}

test("places a limit order and returns the canonical exchange order", async () => {
  const { broker, rpc } = createBroker({
    orderResponse: {
      orderId: 123,
      clientOrderId: "h-12345678901234567890123456789012",
      symbol: "BTCUSDT",
      type: "LIMIT_MAKER",
      side: "BUY",
      origQty: "0.01",
      executedQty: "0",
      price: "65000.10",
      status: "NEW",
      time: 1700000000000,
      updateTime: 1700000000001,
    },
  })

  const result = await broker.createCanonicalOrder({
    symbol: "BTCUSDT",
    clientOrderId: "h-12345678901234567890123456789012",
    side: "BUY",
    type: "LIMIT_MAKER",
    quantity: "0.01",
    price: "65000.10",
  })

  assert.equal(result.ok, true)
  assert.ok(result.data instanceof CanonicalOrder)
  assert.equal(result.data.clientOrderId, "h-12345678901234567890123456789012")
  assert.equal(result.data.brokerOrderId, "123")
  assert.equal(result.data.status, "OPEN")
  assert.equal(result.data.originalQuantity.amount, "0.01")
  assert.equal(result.data.limitPrice.amount, "65000.1")
  assert.equal(rpc.calls[0].method, "order.place")
  assert.equal(rpc.calls[0].params.newClientOrderId, "h-12345678901234567890123456789012")
})

test("rejects missing client order identity before an exchange request", async () => {
  const { broker, rpc } = createBroker({ orderResponse: {} })
  const result = await broker.createCanonicalOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT_MAKER",
    quantity: "0.01",
    price: "65000",
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /requires clientOrderId/)
  assert.equal(rpc.calls.length, 0)
})

test("blocks canonical order placement while user-data stream is unavailable", async () => {
  const { broker, rpc } = createBroker({ orderResponse: {} })
  broker.userDataUnavailable = true
  const result = await broker.createCanonicalOrder({
    symbol: "BTCUSDT",
    clientOrderId: "h-12345678901234567890123456789012",
    side: "BUY",
    type: "LIMIT_MAKER",
    quantity: "0.01",
    price: "65000",
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /user-data stream is unavailable/)
  assert.equal(rpc.calls.length, 0)
})
