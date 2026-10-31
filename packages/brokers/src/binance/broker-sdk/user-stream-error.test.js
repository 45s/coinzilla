import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

describe("BinanceSdkBroker user-data stream errors", () => {
  it("logs RPC connection errors without invoking the event callback", async () => {
    const logs = []
    const rpc = createFakeRpcClient({
      "userDataStream.subscribe.signature": () => ({ subscriptionId: 9 }),
      "userDataStream.unsubscribe": () => ({}),
    })
    rpc.state = "open"
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      logger: { error: (...args) => logs.push(args), info() {} },
    }, { apiClientFactory: () => rpc })
    broker.connected = true
    let eventCalls = 0
    const statuses = []
    const result = await broker.subscribeForUserData({
      onEvent: () => { eventCalls += 1 },
      onStatus: (status) => statuses.push(status),
    })
    assert.equal(result.ok, true)

    const error = new Error("user stream disconnected")
    rpc.emitError(error)

    assert.equal(eventCalls, 0)
    assert.equal(logs.length, 1)
    assert.equal(logs[0][0], "Binance user data stream error")
    assert.equal(logs[0][1], error)
    assert.deepEqual(statuses, [{ type: "rpcError", error, recoveryRequired: false }])
    await result.data.disconnect()
    assert.equal(rpc.listenerCount, 0)
  })
})

it("logs an unexpected user-data socket close even without an onStatus callback", async () => {
  const logs = []
  const rpc = createFakeRpcClient({
    "userDataStream.subscribe.signature": () => ({ subscriptionId: 10 }),
    "userDataStream.unsubscribe": () => ({}),
  })
  rpc.state = "open"
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error: (...args) => logs.push(args), info() {}, warn() {} },
  }, { apiClientFactory: () => rpc })
  broker.connected = true

  const result = await broker.subscribeForUserData({ onEvent: () => {} })
  rpc.state = "closed"
  rpc.emitClose({ code: 1006, reason: "network lost", wasClean: false })

  assert.equal(broker.connected, false)
  assert.equal(broker.userDataUnavailable, true)
  assert.equal(logs.length, 1)
  assert.equal(logs[0][0], "Binance user-data API connection closed")
  assert.deepEqual(logs[0][1], { code: 1006, reason: "network lost" })
  await result.data.disconnect()
})
