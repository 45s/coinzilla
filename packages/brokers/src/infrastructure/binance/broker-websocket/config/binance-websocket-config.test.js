import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { BinanceWebSocketConfig, BINANCE_WEBSOCKET_ENDPOINTS } from "./binance-websocket-config.js"

const credentials = { apiKey: "test-key", apiSecret: "test-secret" }

describe("BinanceWebSocketConfig", () => {
  it("requires non-empty API credentials", () => {
    for (const input of [
      { tradingMode: "testnet" },
      { ...credentials, tradingMode: "testnet", apiKey: "" },
      { ...credentials, tradingMode: "testnet", apiSecret: "" },
    ]) {
      assert.throws(() => new BinanceWebSocketConfig(input), /credentials are required/)
    }
  })

  it("requires an explicit supported trading mode", () => {
    for (const tradingMode of [undefined, "", "development", "production", "LIVE", null]) {
      assert.throws(
        () => new BinanceWebSocketConfig({ ...credentials, tradingMode }),
        /tradingMode must be set to "testnet" or "live"/,
      )
    }
  })

  it("selects TESTNET endpoints for testnet mode", () => {
    const config = new BinanceWebSocketConfig({ ...credentials, tradingMode: "testnet" })
    assert.equal(config.tradingMode, "testnet")
    assert.equal(config.websocketApiUrl, BINANCE_WEBSOCKET_ENDPOINTS.testnet.api)
    assert.equal(config.websocketStreamsUrl, BINANCE_WEBSOCKET_ENDPOINTS.testnet.streams)
  })

  it("selects LIVE endpoints for live mode", () => {
    const config = new BinanceWebSocketConfig({ ...credentials, tradingMode: "live" })
    assert.equal(config.tradingMode, "live")
    assert.equal(config.websocketApiUrl, BINANCE_WEBSOCKET_ENDPOINTS.production.api)
    assert.equal(config.websocketStreamsUrl, BINANCE_WEBSOCKET_ENDPOINTS.production.streams)
  })

  it("uses a default reconnect delay of 5000 ms", () => {
    assert.equal(
      new BinanceWebSocketConfig({ ...credentials, tradingMode: "testnet" }).reconnectDelay,
      5000,
    )
  })

  it("accepts a custom reconnect delay including zero", () => {
    assert.equal(new BinanceWebSocketConfig({ ...credentials, tradingMode: "testnet", reconnectDelay: 1000 }).reconnectDelay, 1000)
    assert.equal(new BinanceWebSocketConfig({ ...credentials, tradingMode: "testnet", reconnectDelay: 0 }).reconnectDelay, 0)
  })

  it("rejects invalid reconnect delays", () => {
    for (const reconnectDelay of [-1, 1.5, NaN, "5000"]) {
      assert.throws(
        () => new BinanceWebSocketConfig({ ...credentials, tradingMode: "testnet", reconnectDelay }),
        /non-negative integer/,
      )
    }
  })

  it("allows custom WebSocket URLs and preserves explicit null as mode defaults", () => {
    const custom = new BinanceWebSocketConfig({
      ...credentials,
      tradingMode: "live",
      websocketApiUrl: "wss://example.com/api",
      websocketStreamsUrl: "wss://example.com/streams",
    })
    assert.equal(custom.websocketApiUrl, "wss://example.com/api")
    assert.equal(custom.websocketStreamsUrl, "wss://example.com/streams")

    const fallback = new BinanceWebSocketConfig({
      ...credentials,
      tradingMode: "testnet",
      websocketApiUrl: null,
      websocketStreamsUrl: null,
    })
    assert.equal(fallback.websocketApiUrl, BINANCE_WEBSOCKET_ENDPOINTS.testnet.api)
    assert.equal(fallback.websocketStreamsUrl, BINANCE_WEBSOCKET_ENDPOINTS.testnet.streams)
  })
})
