import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

describe("BinanceSdkBroker.getOrder partial fills", () => {
  it("returns the unfilled quantity for a partially filled order", async () => {
    const rpc = createFakeRpcClient({
      "order.status": (args) => {
        assert.deepEqual(args, { symbol: "ETHUSDT", orderId: 17 })
        return { symbol: "ETHUSDT", orderId: 17, type: "LIMIT", side: "SELL", price: "2500", origQty: "4", executedQty: "1.5" }
      },
    })
    const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret" })
    broker.tradingConnection = rpc
    const result = await broker.getOrder({ symbol: "ETHUSDT", orderId: 17 })
    assert.equal(result.ok, true)
    assert.equal(result.data.quantity, 2.5)
    assert.equal(result.data.id, "17")
    assert.equal(result.data.side, "SELL")
  })
})
