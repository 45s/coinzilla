import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

describe("BinanceSdkBroker.cancelOrder success", () => {
  it("uses order.cancel and adapts the canceled order", async () => {
    const rpc = createFakeRpcClient({
      "order.cancel": (params) => {
        assert.deepEqual(params, { symbol: "BTCUSDT", orderId: 23 })
        return { symbol: "BTCUSDT", orderId: 23, type: "LIMIT", side: "BUY", price: "100", origQty: "2", executedQty: "0" }
      },
    })
    const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret" })
    broker.tradingConnection = rpc
    const result = await broker.cancelOrder({ symbol: "BTCUSDT", orderId: 23 })
    assert.equal(rpc.calls[0].method, "order.cancel")
    assert.equal(rpc.calls[0].options.stateChanging, true)
    assert.equal(result.ok, true)
    assert.equal(result.data.id, "23")
    assert.equal(result.data.quantity, 2)
  })
})
