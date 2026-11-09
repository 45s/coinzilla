import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceWebSocketConfig, BINANCE_WEBSOCKET_ENDPOINTS } from "./binance-websocket-config.js"

describe("BinanceWebSocketConfig URL fallback", () => {
  it("uses TESTNET defaults when custom URLs are null in testnet mode", () => {
    const config = new BinanceWebSocketConfig({
      apiKey: "test-key",
      apiSecret: "test-secret",
      tradingMode: "testnet",
      websocketApiUrl: null,
      websocketStreamsUrl: null,
    })
    assert.equal(config.websocketApiUrl, BINANCE_WEBSOCKET_ENDPOINTS.testnet.api)
    assert.equal(config.websocketStreamsUrl, BINANCE_WEBSOCKET_ENDPOINTS.testnet.streams)
  })

  it("uses LIVE defaults when custom URLs are null in live mode", () => {
    const config = new BinanceWebSocketConfig({
      apiKey: "test-key",
      apiSecret: "test-secret",
      tradingMode: "live",
      websocketApiUrl: null,
      websocketStreamsUrl: null,
    })
    assert.equal(config.websocketApiUrl, BINANCE_WEBSOCKET_ENDPOINTS.production.api)
    assert.equal(config.websocketStreamsUrl, BINANCE_WEBSOCKET_ENDPOINTS.production.streams)
  })
})
