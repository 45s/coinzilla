import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"

function createBroker() {
  return new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {}, debug() {}, warn() {} },
  })
}

describe("BinanceSdkBroker.disconnect", () => {
  it("disconnects both connections and clears references", async () => {
    const broker = createBroker()
    let tradingDisconnected = false
    let marketDisconnected = false
    broker.tradingConnection = {
      disconnect: async () => { tradingDisconnected = true },
    }
    broker.marketConnection = {
      disconnect: async () => { marketDisconnected = true },
    }

    await broker.disconnect()

    assert.equal(tradingDisconnected, true)
    assert.equal(marketDisconnected, true)
    assert.equal(broker.tradingConnection, null)
    assert.equal(broker.marketConnection, null)
  })

  it("clears connections even when a disconnect rejects", async () => {
    const broker = createBroker()
    broker.tradingConnection = {
      disconnect: async () => { throw new Error("socket closed unexpectedly") },
    }
    broker.marketConnection = {
      disconnect: async () => {},
    }

    await assert.doesNotReject(() => broker.disconnect())
    assert.equal(broker.tradingConnection, null)
    assert.equal(broker.marketConnection, null)
  })

  it("is safe to call when no connections are established", async () => {
    const broker = createBroker()
    await assert.doesNotReject(() => broker.disconnect())
    assert.equal(broker.tradingConnection, null)
    assert.equal(broker.marketConnection, null)
  })
})
