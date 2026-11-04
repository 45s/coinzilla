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

const validEvent = {
  u: 123,
  s: "BTCUSDT",
  b: "65000.10",
  B: "0.25000000",
  a: "65000.11",
  A: "0.50000000",
}

describe("BinanceSdkBroker.subscribeForBookTicker", () => {
  it("normalizes exact bid/ask strings and returns an unsubscribe handle", async () => {
    const { broker, streams } = createBroker()
    broker.connected = true
    const received = []
    const result = await broker.subscribeForBookTicker({
      symbol: "BTCUSDT",
      onBookTicker: (event) => received.push(event),
    })

    assert.equal(result.ok, true)
    assert.equal(result.data.stream, "btcusdt@bookTicker")
    assert.equal(streams.calls[0].stream, "btcusdt@bookTicker")

    streams.emit("btcusdt@bookTicker", validEvent)

    assert.equal(received.length, 1)
    assert.deepEqual({
      symbol: received[0].symbol,
      bestBidPrice: received[0].bestBidPrice,
      bestBidQuantity: received[0].bestBidQuantity,
      bestAskPrice: received[0].bestAskPrice,
      bestAskQuantity: received[0].bestAskQuantity,
    }, {
      symbol: "BTCUSDT",
      bestBidPrice: "65000.10",
      bestBidQuantity: "0.25000000",
      bestAskPrice: "65000.11",
      bestAskQuantity: "0.50000000",
    })
    assert.equal(Number.isSafeInteger(received[0].timestamp), true)
    assert.equal(Object.isFrozen(received[0]), true)

    await result.data.unsubscribe()
    assert.equal(streams.calls.at(-1).method, "unsubscribe")
    assert.equal(streams.listenerCount, 0)
  })

  it("rejects malformed or non-positive book values instead of emitting a partial book", async () => {
    const { broker, streams } = createBroker()
    broker.connected = true
    const received = []
    const result = await broker.subscribeForBookTicker({
      symbol: "BTCUSDT",
      onBookTicker: (event) => received.push(event),
    })

    assert.equal(result.ok, true)
    assert.throws(() => streams.emit("btcusdt@bookTicker", { ...validEvent, b: 65000.1 }), /decimal string/)
    assert.throws(() => streams.emit("btcusdt@bookTicker", { ...validEvent, A: "0" }), /must be positive/)
    assert.equal(received.length, 0)
  })

  it("rejects events whose symbol does not match the subscribed market", async () => {
    const { broker, streams } = createBroker()
    broker.connected = true
    const result = await broker.subscribeForBookTicker({
      symbol: "BTCUSDT",
      onBookTicker: () => assert.fail("mismatched event must not be delivered"),
    })

    assert.equal(result.ok, true)
    assert.throws(() => streams.emit("btcusdt@bookTicker", { ...validEvent, s: "ETHUSDT" }), /symbol does not match/)
  })

  it("rejects invalid callback, symbol, and disconnected subscriptions", async () => {
    const { broker, streams } = createBroker()

    const disconnected = await broker.subscribeForBookTicker({
      symbol: "BTCUSDT",
      onBookTicker: () => {},
    })
    assert.equal(disconnected.ok, false)
    assert.match(disconnected.errors[0].message, /must be connected/)

    broker.connected = true
    const invalidCallback = await broker.subscribeForBookTicker({
      symbol: "BTCUSDT",
      onBookTicker: null,
    })
    const invalidSymbol = await broker.subscribeForBookTicker({
      symbol: "",
      onBookTicker: () => {},
    })
    assert.equal(invalidCallback.ok, false)
    assert.equal(invalidSymbol.ok, false)
    assert.equal(streams.calls.length, 0)
  })

  it("returns a structured error when the Streams subscription fails", async () => {
    const { broker, streams } = createBroker()
    broker.connected = true
    streams.subscribe = async () => { throw new Error("stream unavailable") }

    const result = await broker.subscribeForBookTicker({
      symbol: "BTCUSDT",
      onBookTicker: () => {},
    })

    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "stream unavailable")
  })
})
