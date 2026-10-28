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

describe("BinanceSdkBroker.subscribeForPrices", () => {
  it("subscribes to lowercase symbols and forwards adapted trade messages", async () => {
    const broker = createBroker()
    const stream = new EventEmitter()
    let requestedSymbol
    broker.marketConnection = {
      aggTrade: ({ symbol }) => {
        requestedSymbol = symbol
        return stream
      },
    }
    const prices = []

    const result = await broker.subscribeForPrices({
      symbol: "BTCUSDT",
      onPrice: (price) => prices.push(price),
    })

    assert.equal(result.ok, true)
    assert.equal(result.data, stream)
    assert.equal(requestedSymbol, "btcusdt")

    stream.emit("message", {
      e: "aggTrade", E: 100, T: 99, s: "BTCUSDT", p: "65000.10", q: "0.25",
      m: true, M: false, a: 123, f: 120, l: 124,
    })

    assert.deepEqual(prices, [{
      eventType: "aggTrade", eventTime: 100, timestamp: 99, symbol: "BTCUSDT",
      price: "65000.10", quantity: "0.25", isBuyerMaker: true,
      wasBestPrice: false, aggId: 123, firstId: 120, lastId: 124,
    }])
  })

  it("returns a structured error when the stream cannot be created", async () => {
    const broker = createBroker()
    broker.marketConnection = {
      aggTrade: () => { throw new Error("stream unavailable") },
    }

    const result = await broker.subscribeForPrices({
      symbol: "BTCUSDT",
      onPrice: () => {},
    })

    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "stream unavailable")
  })
})
