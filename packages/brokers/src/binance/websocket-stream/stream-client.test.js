import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceStreamClient } from "./stream-client.js"

function createClient() {
  const client = new BinanceStreamClient({
    logger: { info() {}, debug() {}, warn() {}, error() {}, success() {} },
    wsURL: "wss://example.test",
  })
  const urls = []
  client.initConnect = (url) => { urls.push(url) }
  return { client, urls }
}

describe("BinanceStreamClient stream names", () => {
  it("normalizes trade symbols to lowercase", () => {
    const { client, urls } = createClient()
    client.trade({ tickets: ["BTCUSDT"] })
    assert.deepEqual(urls, ["wss://example.test/ws/btcusdt@trade"])
  })

  it("includes the interval in kline streams", () => {
    const { client, urls } = createClient()
    client.kline({ tickets: ["ETHUSDT"], interval: "1m" })
    assert.deepEqual(urls, ["wss://example.test/ws/ethusdt@kline_1m"])
  })

  it("supports combined streams for multiple tickets", () => {
    const { client, urls } = createClient()
    client.combinedStreams = true
    client.trade({ tickets: ["BTCUSDT", "ETHUSDT"] })
    assert.deepEqual(urls, [
      "wss://example.test/stream?streams=btcusdt@trade",
    ])
  })

  it("rejects kline subscriptions without an interval", () => {
    const { client, urls } = createClient()
    assert.throws(() => client.kline({ tickets: ["BTCUSDT"] }))
    assert.deepEqual(urls, [])
  })

  it("uses the all-market mini-ticker stream when no symbol is supplied", () => {
    const { client, urls } = createClient()
    client.miniTicker({})
    assert.deepEqual(urls, ["wss://example.test/ws/!miniTicker@arr"])
  })

  it("uses the symbol-specific ticker stream when a symbol is supplied", () => {
    const { client, urls } = createClient()
    client.ticker({ symbol: "ETHUSDT" })
    assert.deepEqual(urls, ["wss://example.test/ws/ethusdt@ticker"])
  })
})

it("rejects an empty ticket list before connecting", () => {
  const { client, urls } = createClient()
  assert.throws(() => client.trade({ tickets: [] }))
  assert.deepEqual(urls, [])
})
