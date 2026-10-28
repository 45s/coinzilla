import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"

const broker = () => new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret", logger: { error() {}, info() {} } })
const rawOrder = (orderId, symbol = "BTCUSDT") => ({ orderId, symbol, type: "LIMIT", side: "BUY", price: "10", origQty: "3", executedQty: "1" })

describe("BinanceSdkBroker.getOpenOrders", () => {
  it("passes the requested symbol and adapts remaining quantities", async () => {
    const instance = broker()
    let args
    instance.tradingConnection = { openOrdersStatus: async (input) => { args = input; return { data: [rawOrder(1), rawOrder(2, "ETHUSDT")] } } }
    const result = await instance.getOpenOrders({ symbol: "BTCUSDT" })
    assert.deepEqual(args, { symbol: "BTCUSDT" })
    assert.equal(result.ok, true)
    assert.deepEqual(result.data.map((order) => order.quantity), [2, 2])
    assert.deepEqual(result.data.map((order) => order.id), ["1", "2"])
  })

  it("requests all symbols when no filter is provided", async () => {
    const instance = broker()
    let args
    instance.tradingConnection = { openOrdersStatus: async (input) => { args = input; return { data: [] } } }
    const result = await instance.getOpenOrders()
    assert.deepEqual(args, {})
    assert.deepEqual(result.data, [])
  })
})
