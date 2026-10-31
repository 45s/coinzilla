import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

describe("BinanceSdkBroker.createOrder overrides", () => {
  it("preserves explicitly supplied order options", async () => {
    const rpc = createFakeRpcClient({
      "order.place": () => ({ symbol: "BTCUSDT", orderId: 10, type: "MARKET", side: "SELL", price: "100", origQty: "1", executedQty: "0" }),
    })
    const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret" })
    broker.tradingConnection = rpc
    const input = { symbol: "BTCUSDT", quantity: 1, price: 100, side: "SELL", type: "MARKET", timeInForce: "IOC" }
    const result = await broker.createOrder(input)
    assert.deepEqual(rpc.calls[0].params, input)
    assert.equal(result.ok, true)
    assert.equal(result.data.type, "MARKET")
    assert.equal(result.data.side, "SELL")
  })
})
