import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isProdMode } from "@coinzilla/utils"
import { BinanceWebSocketConfig, BINANCE_WEBSOCKET_ENDPOINTS } from "./binance-websocket-config.js"

describe("BinanceWebSocketConfig URL fallback", () => {
  it("uses native WebSocket defaults when custom URLs are null", () => {
    const config = new BinanceWebSocketConfig({
      apiKey: "test-key",
      apiSecret: "test-secret",
      websocketApiUrl: null,
      websocketStreamsUrl: null,
    })
    const endpoints = isProdMode ? BINANCE_WEBSOCKET_ENDPOINTS.production : BINANCE_WEBSOCKET_ENDPOINTS.testnet
    assert.equal(config.websocketApiUrl, endpoints.api)
    assert.equal(config.websocketStreamsUrl, endpoints.streams)
  })
})
