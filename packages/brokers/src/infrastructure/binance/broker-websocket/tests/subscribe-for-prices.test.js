import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { FakeClock } from "../test-helpers/fake-clock.js"
import { flush } from "../test-helpers/streams-client-fixtures.js"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeStreamsClient } from "../test-helpers/fake-broker-clients.js"

function createBroker(dependencies = {}) {
  const streams = createFakeStreamsClient()
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
tradingMode: "testnet",
    logger: { error() {},
info() {},
debug() {},
warn() {} },
  }, { marketClientFactory: () => streams,
    ...dependencies })
  return { broker,
streams }
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
      e: "aggTrade",
E: 100,
T: 99,
s: "BTCUSDT",
p: "65000.10",
q: "0.25",
      m: true,
M: false,
a: 123,
f: 120,
l: 124,
    })

    assert.deepEqual(prices, [{
      eventType: "aggTrade",
eventTime: 100,
timestamp: 99,
symbol: "BTCUSDT",
      price: "65000.10",
quantity: "0.25",
isBuyerMaker: true,
      wasBestPrice: false,
aggId: 123,
firstId: 120,
lastId: 124,
    }])

    await result.data.unsubscribe()
    assert.equal(streams.calls.at(-1).method, "unsubscribe")
  })

  it("uses ticker trade IDs to detect and resubscribe a stalled aggTrade stream", async () => {
    const clock = new FakeClock()
    const { broker, streams } = createBroker({
      setTimeoutFn: clock.setTimeout.bind(clock),
      clearTimeoutFn: clock.clearTimeout.bind(clock),
      nowFn: () => clock.now,
      marketStreamStallTimeoutMs: 50,
    })
    broker.connected = true
    const result = await broker.subscribeForPrices({
      symbol: "BTCUSDT",
      onPrice: () => {},
    })

    assert.equal(result.ok, true)
    assert.deepEqual(
      streams.calls,
      [
        {
          method: "subscribe",
          stream: "btcusdt@aggTrade",
        },
        {
          method: "subscribe",
          stream: "!ticker_1h@arr",
        },
      ],
      "price subscriptions must include one independent all-market ticker activity stream",
    )

    streams.emit("btcusdt@aggTrade", {
      e: "aggTrade",
      E: 100,
      T: 100,
      s: "BTCUSDT",
      p: "65000.10",
      q: "0.25",
      m: true,
      M: false,
      a: 10,
      f: 10,
      l: 10,
    })
    streams.emit("!ticker_1h@arr", {
      e: "1hTicker",
      E: 150,
      s: "BTCUSDT",
      L: 11,
    })

    clock.advanceBy(49)
    assert.equal(
      streams.calls.length,
      2,
      "the broker must allow a grace period for the matching aggregate trade event",
    )
    clock.advanceBy(1)
    await flush()

    assert.deepEqual(
      streams.calls.slice(2),
      [
        {
          method: "unsubscribe",
          stream: "btcusdt@aggTrade",
        },
        {
          method: "subscribe",
          stream: "btcusdt@aggTrade",
        },
      ],
      "only the stalled symbol's aggTrade stream must be resubscribed",
    )

    streams.emit("btcusdt@aggTrade", {
      e: "aggTrade",
      E: 200,
      T: 200,
      s: "BTCUSDT",
      p: "65000.11",
      q: "0.10",
      m: false,
      M: false,
      a: 11,
      f: 11,
      l: 11,
    })
    await result.data.unsubscribe()
    assert.equal(
      streams.listenerCount,
      0,
      "unsubscribing a price feed must remove both aggTrade and shared ticker listeners",
    )
  })

  it("returns a structured error when the stream cannot be subscribed", async () => {
    const { broker, streams } = createBroker()
    broker.connected = true
    streams.subscribe = async () => { throw new Error("stream unavailable") }
    const result = await broker.subscribeForPrices({ symbol: "BTCUSDT",
onPrice: () => {} })
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "stream unavailable")
  })

  it("rejects invalid callback and symbol input as a structured error", async () => {
    const { broker, streams } = createBroker()
    broker.connected = true
    const result = await broker.subscribeForPrices({ symbol: "",
onPrice: () => {} })
    assert.equal(result.ok, false)
    assert.equal(streams.calls.length, 0)
  })
})
