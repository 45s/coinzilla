import test from "node:test"
import assert from "node:assert/strict"

import { BinanceSdkBroker } from "./broker.js"

function createBroker(orderPlace, sendSignedMessage = async () => {
  throw new Error("Unexpected signed raw WebSocket request")
}) {
  const broker = Object.create(BinanceSdkBroker.prototype)
  broker.tradingConnection = { orderPlace, sendSignedMessage }
  broker.logger = { error() {} }
  return broker
}

const exchangeOrder = {
  symbol: "DOGEFDUSD",
  orderId: 123,
  clientOrderId: "FR_DOGE_0001",
  type: "LIMIT",
  side: "BUY",
  price: "0.05",
  origQty: "100",
  executedQty: "0",
}

test("createOrder maps optional clientOrderId to Binance newClientOrderId", async () => {
  let received
  const broker = createBroker(async (params) => {
    received = params
    return { data: exchangeOrder }
  })

  const result = await broker.createOrder({
    symbol: "DOGEFDUSD",
    side: "BUY",
    type: "LIMIT",
    price: "0.05",
    quantity: "100",
    clientOrderId: "FR_DOGE_0001",
  })

  assert.equal(result.ok, true)
  assert.equal(received.newClientOrderId, "FR_DOGE_0001")
  assert.equal("clientOrderId" in received, false)
  assert.equal(result.data.clientOrderId, "FR_DOGE_0001")
})

test("createOrder omits Binance client order ID when it is not provided", async () => {
  let received
  const broker = createBroker(async (params) => {
    received = params
    return { data: { ...exchangeOrder, clientOrderId: "binance-generated-id" } }
  })

  const result = await broker.createOrder({
    symbol: "DOGEFDUSD",
    side: "BUY",
    type: "LIMIT",
    price: "0.05",
    quantity: "100",
  })

  assert.equal(result.ok, true)
  assert.equal("newClientOrderId" in received, false)
  assert.equal("clientOrderId" in received, false)
  assert.equal(result.data.clientOrderId, "binance-generated-id")
})

test("createOrder submits LIMIT_MAKER through the signed raw WebSocket method", async () => {
  let received
  let method
  const broker = createBroker(
    async () => {
      assert.fail("LIMIT_MAKER must bypass enum-validated orderPlace()")
    },
    async (requestMethod, params) => {
      method = requestMethod
      received = params
      return { data: { ...exchangeOrder, type: "LIMIT_MAKER" } }
    },
  )

  const result = await broker.createOrder({
    symbol: "DOGEFDUSD",
    side: "BUY",
    type: "LIMIT_MAKER",
    timeInForce: "GTC",
    price: "0.05",
    quantity: "100",
  })

  assert.equal(result.ok, true)
  assert.equal(method, "order.place")
  assert.equal(received.type, "LIMIT_MAKER")
  assert.equal("timeInForce" in received, false)
  assert.equal(result.data.type, "LIMIT_MAKER")
})
