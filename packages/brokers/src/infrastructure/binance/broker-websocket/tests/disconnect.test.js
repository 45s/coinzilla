import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeRpcClient, createFakeStreamsClient } from "../test-helpers/fake-broker-clients.js"

function createBroker() {
  const rpc = createFakeRpcClient()
  const streams = createFakeStreamsClient()
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {}, debug() {}, warn() {} },
  }, {
    apiClientFactory: () => rpc,
    marketClientFactory: () => streams,
  })
  return { broker, rpc, streams }
}

describe("BinanceSdkBroker.disconnect", () => {
  it("disconnects both native clients and is idempotent", async () => {
    const { broker, rpc, streams } = createBroker()
    await broker.connect()
    await broker.disconnect()
    await broker.disconnect()
    assert.equal(rpc.state, "closed")
    assert.equal(broker.connected, false)
    assert.equal(streams.listenerCount, 0)
  })

  it("attempts both disconnects and logs failures without masking shutdown", async () => {
    const { broker, rpc } = createBroker()
    let marketDisconnected = false
    broker.marketConnection.disconnect = () => {
      marketDisconnected = true
      throw new Error("market close failed")
    }
    await broker.connect()
    await assert.doesNotReject(() => broker.disconnect())
    assert.equal(rpc.state, "closed")
    assert.equal(marketDisconnected, true)
  })

  it("is safe to call before connect", async () => {
    const { broker } = createBroker()
    await assert.doesNotReject(() => broker.disconnect())
    assert.equal(broker.connected, false)
  })
})
