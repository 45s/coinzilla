import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"

describe("BinanceSdkBroker user-data stream errors", () => {
  it("logs stream errors without invoking the event callback", async () => {
    const logs = []
    const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret", logger: { error: (...args) => logs.push(args), info() {} } })
    const stream = new EventEmitter()
    broker.tradingConnection = { userDataStreamSubscribeSignature: async () => ({ stream }) }
    let eventCalls = 0
    const result = await broker.subscribeForUserData({ onEvent: () => { eventCalls += 1 } })
    assert.equal(result.ok, true)
    const error = new Error("user stream disconnected")
    stream.emit("error", error)
    assert.equal(eventCalls, 0)
    assert.equal(logs.length, 1)
    assert.equal(logs[0][0], "Binance user data stream error")
    assert.equal(logs[0][1], error)
  })
})
