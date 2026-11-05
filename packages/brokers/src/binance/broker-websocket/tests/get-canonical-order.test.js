import assert from "node:assert/strict"
import test from "node:test"
import { CanonicalOrder } from "@coinzilla/entities"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeRpcClient } from "../test-helpers/fake-broker-clients.js"

const symbolInfo = { symbol: "DOGEUSDT", baseAsset: "DOGE", quoteAsset: "USDT" }
const rawOrder = {
  symbol: "DOGEUSDT",
  orderId: 987654,
  clientOrderId: "harvester-client-123",
  side: "BUY",
  type: "LIMIT_MAKER",
  status: "FILLED",
  price: "0.07598",
  origQty: "400.00000000",
  executedQty: "400.00000000",
  time: 1_800_000_000_000,
  updateTime: 1_800_000_000_100,
}

function createBroker(handlers) {
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {} },
  })
  broker.tradingConnection = createFakeRpcClient(handlers)
  return broker
}

test("getCanonicalOrder resolves a lost submission acknowledgement by client order ID", async () => {
  const broker = createBroker({
    orderStatus(params, options) {
      assert.deepEqual(params, { symbol: "DOGEUSDT", origClientOrderId: "harvester-client-123" })
      assert.deepEqual(options, { signed: true })
      return rawOrder
    },
    exchangeInfo(params) {
      assert.deepEqual(params, { symbol: "DOGEUSDT" })
      return { symbols: [symbolInfo] }
    },
  })

  const result = await broker.getCanonicalOrder({
    symbol: "DOGEUSDT",
    clientOrderId: "harvester-client-123",
  })

  assert.equal(result.ok, true)
  assert.ok(result.data instanceof CanonicalOrder)
  assert.equal(result.data.clientOrderId, "harvester-client-123")
  assert.equal(result.data.brokerOrderId, "987654")
  assert.equal(result.data.status, "FILLED")
  assert.equal(result.data.originalQuantity.amount, "400")
  assert.equal(result.data.executedQuantity.amount, "400")
  assert.equal(result.data.limitPrice.amount, "0.07598")
  assert.deepEqual(broker.tradingConnection.calls.map(({ method }) => method), ["order.status", "exchangeInfo"])
})

test("getCanonicalOrder supports exact broker order ID lookup", async () => {
  const broker = createBroker({
    orderStatus(params) {
      assert.deepEqual(params, { symbol: "DOGEUSDT", orderId: 987654 })
      return rawOrder
    },
    exchangeInfo: () => ({ symbols: [symbolInfo] }),
  })

  const result = await broker.getCanonicalOrder({ symbol: "DOGEUSDT", orderId: 987654 })

  assert.equal(result.ok, true)
  assert.equal(result.data.brokerOrderId, "987654")
})

test("getCanonicalOrder rejects missing or ambiguous identifiers before RPC", async () => {
  const broker = createBroker({})

  for (const input of [
    { symbol: "DOGEUSDT" },
    { symbol: "DOGEUSDT", orderId: 987654, clientOrderId: "harvester-client-123" },
    { symbol: "DOGEUSDT", orderId: 0 },
    { symbol: "", clientOrderId: "harvester-client-123" },
  ]) {
    const result = await broker.getCanonicalOrder(input)
    assert.equal(result.ok, false)
    assert.ok(result.errors.length > 0)
  }

  assert.deepEqual(broker.tradingConnection.calls, [])
})

test("getCanonicalOrder fails closed when order status or market metadata is malformed", async () => {
  for (const handlers of [
    { orderStatus: () => ({ ...rawOrder, executedQty: 400 }), exchangeInfo: () => ({ symbols: [symbolInfo] }) },
    { orderStatus: () => rawOrder, exchangeInfo: () => ({ symbols: [symbolInfo, symbolInfo] }) },
  ]) {
    const broker = createBroker(handlers)
    const result = await broker.getCanonicalOrder({ symbol: "DOGEUSDT", clientOrderId: "harvester-client-123" })
    assert.equal(result.ok, false)
    assert.ok(result.errors.length > 0)
  }
})
