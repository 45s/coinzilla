import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { subscribeForPrices } from "./subscribe-for-prices.js"

describe("subscribeForPrices", () => {
  it("subscribes to aggregate trades and forwards parsed prices", (t) => {
    const originalWebSocket = globalThis.WebSocket
    t.after(() => {
      globalThis.WebSocket = originalWebSocket
    })

    const sockets = []
    const logs = []
    const received = []

    globalThis.WebSocket = class FakeWebSocket {
      constructor(url) {
        this.url = url
        this.listeners = {}
        this.sent = []
        sockets.push(this)
      }
      addEventListener(name, callback) {
        this.listeners[name] = callback
      }
      send(value) {
        this.sent.push(value)
      }
    }

    const result = subscribeForPrices({
      symbols: ["BTCUSDT", "ETHUSDT"],
      onMessage: (message) => received.push(message),
      logger: { info: (message) => logs.push(message), error: (error) => { throw error } },
    })
    const socket = result.socket

    assert.equal(socket.url, "wss://stream.binance.com:9443/ws")
    socket.listeners.open()
    assert.deepEqual(JSON.parse(socket.sent[0]), {
      method: "SUBSCRIBE",
      params: ["btcusdt@aggTrade", "ethusdt@aggTrade"],
      id: 1,
    })
    assert.deepEqual(logs, ["BINANCE_PRICE_SOCKET_OPEN BTCUSDT,ETHUSDT"])

    socket.listeners.message({ data: JSON.stringify({ s: "BTCUSDT", p: "65000.10" }) })
    assert.deepEqual(received, [{ symbol: "BTCUSDT", price: "65000.10" }])
  })
})
