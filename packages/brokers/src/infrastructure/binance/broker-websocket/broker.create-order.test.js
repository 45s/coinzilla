import test from "node:test"
import assert from "node:assert/strict"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

const exchangeOrder = {
  symbol: "DOGEFDUSD", orderId: 123, clientOrderId: "FR_DOGE_0001",
  type: "LIMIT", side: "BUY", price: "0.05", origQty: "100", executedQty: "0",
}

function createBroker(handler) {
  const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret" })
  broker.tradingConnection = createFakeRpcClient({ "order.place": handler })
  return broker
}

test("createOrder maps optional clientOrderId to Binance newClientOrderId", async () => {
  let received
  const broker = createBroker((params) => { received = params; return exchangeOrder })
  const result = await broker.createOrder({
    symbol: "DOGEFDUSD", side: "BUY", type: "LIMIT", price: "0.05",
    quantity: "100", clientOrderId: "FR_DOGE_0001",
  })
  assert.equal(result.ok, true)
  assert.equal(received.newClientOrderId, "FR_DOGE_0001")
  assert.equal("clientOrderId" in received, false)
  assert.equal(result.data.clientOrderId, "FR_DOGE_0001")
})

test("createOrder omits Binance client order ID when it is not provided", async () => {
  let received
  const broker = createBroker((params) => {
    received = params
    return { ...exchangeOrder, clientOrderId: "binance-generated-id" }
  })
  const result = await broker.createOrder({
    symbol: "DOGEFDUSD", side: "BUY", type: "LIMIT", price: "0.05", quantity: "100",
  })
  assert.equal(result.ok, true)
  assert.equal("newClientOrderId" in received, false)
  assert.equal("clientOrderId" in received, false)
  assert.equal(result.data.clientOrderId, "binance-generated-id")
})

test("createOrder omits timeInForce for LIMIT_MAKER post-only orders", async () => {
  let received
  const broker = createBroker((params) => {
    received = params
    return { ...exchangeOrder, type: "LIMIT_MAKER" }
  })
  const result = await broker.createOrder({
    symbol: "DOGEFDUSD", side: "BUY", type: "LIMIT_MAKER", timeInForce: "GTC",
    price: "0.05", quantity: "100",
  })
  assert.equal(result.ok, true)
  assert.equal(received.type, "LIMIT_MAKER")
  assert.equal("timeInForce" in received, false)
})
