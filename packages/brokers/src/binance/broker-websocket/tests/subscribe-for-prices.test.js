import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeStreamsClient } from "../test-helpers/fake-broker-clients.js"

function createBroker() {
  const streams = createFakeStreamsClient()
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {}, debug() {}, warn() {} },
  }, { marketClientFactory: () => streams })
  return { broker, streams }
}

describe("BinanceSdkBroker.subscribeForPrices", () => {
  it("subscribes to lowercase aggregate-trade streams and forwards adapted messages", async () => {
    const { broker, streams } = createBroker()
    broker.connected = true
    const prices = []
    const result = await broker.subscribeForPrices({
      symbol: "BTCUSDT",
      onPrice: (price) => prices.push(price),
    })

    assert.equal(result.ok, true)
    assert.equal(result.data.stream, "btcusdt@aggTrade")
    assert.equal(streams.calls[0].stream, "btcusdt@aggTrade")

    streams.emit("btcusdt@aggTrade", {
      e: "aggTrade", E: 100, T: 99, s: "BTCUSDT", p: "65000.10", q: "0.25",
      m: true, M: false, a: 123, f: 120, l: 124,
    })

    assert.deepEqual(prices, [{
      eventType: "aggTrade", eventTime: 100, timestamp: 99, symbol: "BTCUSDT",
      price: "65000.10", quantity: "0.25", isBuyerMaker: true,
      wasBestPrice: false, aggId: 123, firstId: 120, lastId: 124,
    }])

    await result.data.unsubscribe()
    assert.equal(streams.calls.at(-1).method, "unsubscribe")
  })

  it("returns a structured error when the stream cannot be subscribed", async () => {
    const { broker, streams } = createBroker()
    broker.connected = true
    streams.subscribe = async () => { throw new Error("stream unavailable") }
    const result = await broker.subscribeForPrices({ symbol: "BTCUSDT", onPrice: () => {} })
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "stream unavailable")
  })

  it("rejects invalid callback and symbol input as a structured error", async () => {
    const { broker, streams } = createBroker()
    broker.connected = true
    const result = await broker.subscribeForPrices({ symbol: "", onPrice: () => {} })
    assert.equal(result.ok, false)
    assert.equal(streams.calls.length, 0)
  })
})
