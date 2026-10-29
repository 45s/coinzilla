import test from "node:test"
import assert from "node:assert/strict"

import { BinanceSdkBroker } from "./broker.js"

function createBroker(orderPlace) {
  const broker = Object.create(BinanceSdkBroker.prototype)
  broker.tradingConnection = { orderPlace }
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
