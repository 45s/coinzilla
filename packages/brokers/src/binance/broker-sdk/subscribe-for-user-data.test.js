import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"

function createBroker() {
  return new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {}, debug() {}, warn() {} },
  })
}

describe("BinanceSdkBroker.subscribeForUserData", () => {
  it("forwards adapted user events from the SDK stream", async () => {
    const broker = createBroker()
    const stream = new EventEmitter()
    broker.tradingConnection = {
      userDataStreamSubscribeSignature: async () => ({ stream }),
    }
    const received = []

    const result = await broker.subscribeForUserData({
      onEvent: (event) => received.push(event),
    })

    assert.equal(result.ok, true)
    assert.equal(result.data, stream)

    stream.emit("message", {
      e: "balanceUpdate", a: "USDT", d: "12.50", T: 200, E: 201,
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

  it("returns a structured error when stream setup fails", async () => {
    const broker = createBroker()
    broker.tradingConnection = {
      userDataStreamSubscribeSignature: async () => {
        throw new Error("user stream unavailable")
      },
    }

    const result = await broker.subscribeForUserData({ onEvent: () => {} })
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "user stream unavailable")
  })
})
