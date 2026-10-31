import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { BinanceSdkBroker } from "./broker.js"

function createBroker(connection) {
  const broker = new BinanceSdkBroker({
    apiKey: "test-api-key",
    apiSecret: "test-api-secret",
    logger: { error() {} },
  })
  broker.tradingConnection = connection
  return broker
}

const exchangeOrder = {
  symbol: "ZROFDUSD",
  orderId: 123,
  clientOrderId: "test-client-order",
  type: "LIMIT_MAKER",
  side: "BUY",
  price: "1.700",
  origQty: "5",
  executedQty: "0",
  status: "NEW",
}

describe("BinanceSdkBroker.createOrder", () => {
  it("sends LIMIT_MAKER through the SDK signed raw WebSocket method", async () => {
    let signedRequest
    const broker = createBroker({
      orderPlace() {
        assert.fail("LIMIT_MAKER must not use the SDK enum-validated orderPlace method")
      },
      async sendSignedMessage(method, params) {
        signedRequest = { method, params }
        return { data: exchangeOrder }
      },
    })

    const result = await broker.createOrder({
      symbol: "ZROFDUSD",
      side: "BUY",
      type: "LIMIT_MAKER",
      timeInForce: "GTC",
      quantity: "5",
      price: "1.700",
    })

    assert.equal(result.ok, true)
    assert.equal(signedRequest.method, "order.place")
    assert.deepEqual(signedRequest.params, {
      symbol: "ZROFDUSD",
      side: "BUY",
      type: "LIMIT_MAKER",
      quantity: "5",
      price: "1.700",
    })
    assert.equal(result.data.id, "123")
    assert.equal(result.data.type, "LIMIT_MAKER")
  })

  it("keeps ordinary LIMIT orders on the typed SDK method", async () => {
    let placedParams
    const broker = createBroker({
      async orderPlace(params) {
        placedParams = params
        return {
          data: {
            ...exchangeOrder,
            type: "LIMIT",
          },
        }
      },
      sendSignedMessage() {
        assert.fail("Ordinary LIMIT orders should use orderPlace")
      },
    })

    const result = await broker.createOrder({
      symbol: "ZROFDUSD",
      side: "SELL",
      type: "LIMIT",
      quantity: "5",
      price: "1.710",
    })

    assert.equal(result.ok, true)
    assert.deepEqual(placedParams, {
      symbol: "ZROFDUSD",
      side: "SELL",
      type: "LIMIT",
      quantity: "5",
      price: "1.710",
      timeInForce: "GTC",
    })
    assert.equal(result.data.type, "LIMIT")
  })
})
