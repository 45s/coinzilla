import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

describe("BinanceSdkBroker user-data stream errors", () => {
  it("logs RPC connection errors without invoking the event callback", async () => {
    const logs = []
    const rpc = createFakeRpcClient({ "userDataStream.subscribe.signature": () => ({ subscriptionId: 9 }) })
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      logger: { error: (...args) => logs.push(args), info() {} },
    }, { apiClientFactory: () => rpc })
    let eventCalls = 0
    const result = await broker.subscribeForUserData({ onEvent: () => { eventCalls += 1 } })
    assert.equal(result.ok, true)

    const error = new Error("user stream disconnected")
    rpc.emitError(error)

    assert.equal(eventCalls, 0)
    assert.equal(logs.length, 1)
    assert.equal(logs[0][0], "Binance user data stream error")
    assert.equal(logs[0][1], error)
    result.data.unsubscribeLocal()
    assert.equal(rpc.listenerCount, 0)
  })
})
