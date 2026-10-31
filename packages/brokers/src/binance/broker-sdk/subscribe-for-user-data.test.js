import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

function createBroker(handler) {
  const rpc = createFakeRpcClient({ "userDataStream.subscribe.signature": handler })
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {}, debug() {}, warn() {} },
  }, { apiClientFactory: () => rpc })
  return { broker, rpc }
}

describe("BinanceSdkBroker.subscribeForUserData", () => {
  it("uses the signature subscription method and forwards adapted events", async () => {
    const { broker, rpc } = createBroker(() => ({ subscriptionId: 7 }))
    broker.connected = true
    const received = []
    const result = await broker.subscribeForUserData({ onEvent: (event) => received.push(event) })

    assert.equal(result.ok, true)
    assert.equal(result.data.subscriptionId, 7)
    assert.deepEqual(rpc.calls[0], {
      method: "userDataStream.subscribe.signature",
      params: {},
      options: { signed: true },
    })

    rpc.emitEvent({
      subscriptionId: 7,
      event: { e: "balanceUpdate", a: "USDT", d: "12.50", T: 200, E: 201 },
    })

    assert.deepEqual(received, [{
      event: {
        asset: "USDT",
        balanceDelta: "12.50",
        clearTime: 200,
        eventTime: 201,
        eventType: "balanceUpdate",
      },
    }])
  })

  it("removes its event listener when subscription setup fails", async () => {
    const { broker, rpc } = createBroker(async () => { throw new Error("user stream unavailable") })
    broker.connected = true
    const result = await broker.subscribeForUserData({ onEvent: () => {} })
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "user stream unavailable")
    assert.equal(rpc.listenerCount, 0)
  })

  it("returns a local unsubscribe function and stops forwarding after cleanup", async () => {
    const { broker, rpc } = createBroker(() => ({ subscriptionId: 8 }))
    broker.connected = true
    const received = []
    const result = await broker.subscribeForUserData({ onEvent: (event) => received.push(event) })
    result.data.unsubscribeLocal()
    rpc.emitEvent({ e: "futureEvent", value: 1 })
    assert.deepEqual(received, [])
    assert.equal(rpc.listenerCount, 0)
  })
})
