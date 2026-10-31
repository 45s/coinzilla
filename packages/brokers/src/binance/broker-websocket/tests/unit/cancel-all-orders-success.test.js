import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

describe("BinanceSdkBroker.cancelAllOpenOrders success", () => {
  it("uses openOrders.cancelAll and adapts each canceled order", async () => {
    const rpc = createFakeRpcClient({
      "openOrders.cancelAll": () => [
        { symbol: "BTCUSDT", orderId: 1, type: "LIMIT", side: "BUY", price: "100", origQty: "2", executedQty: "0" },
        { symbol: "BTCUSDT", orderId: 2, type: "LIMIT", side: "SELL", price: "101", origQty: "3", executedQty: "1" },
      ],
    })
    const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret" })
    broker.tradingConnection = rpc
    const result = await broker.cancelAllOpenOrders({ symbol: "BTCUSDT" })
    assert.deepEqual(rpc.calls[0], {
      method: "openOrders.cancelAll",
      params: { symbol: "BTCUSDT" },
      options: { signed: true, stateChanging: true },
    })
    assert.equal(result.ok, true)
    assert.deepEqual(result.data.map((order) => order.id), ["1", "2"])
    assert.deepEqual(result.data.map((order) => order.quantity), [2, 2])
  })
})
