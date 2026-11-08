import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeRpcClient } from "../test-helpers/fake-broker-clients.js"

describe("BinanceSdkBroker.createOrder defaults", () => {
  it("supplies default side, type, and time-in-force to order.place", async () => {
    const rpc = createFakeRpcClient({
      "order.place": () => ({ symbol: "BTCUSDT", orderId: 9, type: "LIMIT", side: "BUY", price: "100", origQty: "2", executedQty: "0" }),
    })
    const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret" })
    broker.tradingConnection = rpc
    const result = await broker.createOrder({ symbol: "BTCUSDT", quantity: 2, price: 100 })
    assert.deepEqual(rpc.calls[0].params, { symbol: "BTCUSDT", quantity: 2, price: 100, side: "BUY", type: "LIMIT", timeInForce: "GTC" })
    assert.equal(rpc.calls[0].method, "order.place")
    assert.deepEqual(rpc.calls[0].options, { signed: true, stateChanging: true })
    assert.equal(result.ok, true)
    assert.equal(result.data.id, "9")
    assert.equal(result.data.quantity, 2)
  })
})
