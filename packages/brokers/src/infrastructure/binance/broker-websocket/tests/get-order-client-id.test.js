import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "../broker.js"
import { BinanceRpcError } from "../utils/rpc-client.js"
import { createFakeRpcClient } from "../test-helpers/fake-broker-clients.js"

const rawOrder = {
  symbol: "ETHUSDT",
  orderId: 17,
  clientOrderId: "harvester-client-123",
  type: "LIMIT",
  side: "BUY",
  status: "PARTIALLY_FILLED",
  price: "2500.00",
  origQty: "4.000",
  executedQty: "1.250",
}

function createBroker(handlers) {
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {}, debug() {}, warn() {} },
  })
  const rpc = createFakeRpcClient(handlers)
  broker.tradingConnection = rpc
  return { broker, rpc }
}

describe("BinanceSdkBroker.getOrder client-order-ID lookup", () => {
  it("queries order.status with origClientOrderId and adapts the order", async () => {
    const { broker, rpc } = createBroker({
      "order.status": (params, options) => {
        assert.deepEqual(params, {
          symbol: "ETHUSDT",
          origClientOrderId: "harvester-client-123",
        })
        assert.deepEqual(options, { signed: true })
        return rawOrder
      },
    })

    const result = await broker.getOrder({
      symbol: "ETHUSDT",
      clientOrderId: "harvester-client-123",
    })

    assert.equal(result.ok, true)
    assert.equal(result.data.id, "17")
    assert.equal(result.data.clientOrderId, "harvester-client-123")
    assert.equal(result.data.quantity, 2.75)
    assert.equal(result.data.originalQuantity, "4.000")
    assert.equal(result.data.executedQuantity, "1.250")
    assert.deepEqual(rpc.calls.map(({ method }) => method), ["order.status"])
  })

  it("rejects missing, conflicting, and empty lookup identities before RPC", async () => {
    const { broker, rpc } = createBroker({})
    for (const input of [
      { symbol: "ETHUSDT" },
      { symbol: "ETHUSDT", orderId: 17, clientOrderId: "harvester-client-123" },
      { symbol: "ETHUSDT", clientOrderId: " " },
      { symbol: " ", clientOrderId: "harvester-client-123" },
    ]) {
      const result = await broker.getOrder(input)
      assert.equal(result.ok, false)
      assert.ok(result.errors.length > 0)
    }
    assert.deepEqual(rpc.calls, [])
  })

  it("maps Binance's definitive -2013 no-such-order response to a successful null result", async () => {
    const notFound = new BinanceRpcError("Order does not exist.", {
      code: -2013,
      method: "order.status",
    })
    const { broker } = createBroker({
      "order.status": async () => { throw notFound },
    })

    const result = await broker.getOrder({
      symbol: "ETHUSDT",
      clientOrderId: "harvester-client-123",
    })

    assert.equal(result.ok, true)
    assert.equal(result.data, null)
  })

  it("keeps authentication, transport, and other API errors as failures", async () => {
    const rejected = new BinanceRpcError("Invalid API-key, IP, or permissions for action.", {
      code: -2015,
      method: "order.status",
    })
    const { broker } = createBroker({
      "order.status": async () => { throw rejected },
    })

    const result = await broker.getOrder({
      symbol: "ETHUSDT",
      clientOrderId: "harvester-client-123",
    })

    assert.equal(result.ok, false)
    assert.equal(result.errors[0], rejected)
  })
})
