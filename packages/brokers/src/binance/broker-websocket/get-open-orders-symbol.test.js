import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

const createBroker = (handler) => {
  const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret" })
  const rpc = createFakeRpcClient({ "openOrders.status": handler })
  broker.tradingConnection = rpc
  return { broker, rpc }
}
const rawOrder = (orderId, symbol = "BTCUSDT") => ({ orderId, symbol, type: "LIMIT", side: "BUY", price: "10", origQty: "3", executedQty: "1" })

describe("BinanceSdkBroker.getOpenOrders", () => {
  it("passes the requested symbol and adapts remaining quantities", async () => {
    const { broker, rpc } = createBroker(() => [rawOrder(1), rawOrder(2, "ETHUSDT")])
    const result = await broker.getOpenOrders({ symbol: "BTCUSDT" })
    assert.deepEqual(rpc.calls[0].params, { symbol: "BTCUSDT" })
    assert.equal(result.ok, true)
    assert.deepEqual(result.data.map((order) => order.quantity), [2, 2])
    assert.deepEqual(result.data.map((order) => order.id), ["1", "2"])
  })

  it("requests all symbols when no filter is provided", async () => {
    const { broker, rpc } = createBroker(() => [])
    const result = await broker.getOpenOrders()
    assert.deepEqual(rpc.calls[0].params, {})
    assert.deepEqual(result.data, [])
  })
})
