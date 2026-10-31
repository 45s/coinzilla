import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isProdMode } from "@coinzilla/utils"
import { BinanceSdkConfig, BINANCE_WEBSOCKET_ENDPOINTS } from "./binance-sdk-config.js"

const credentials = { apiKey: "test-key", apiSecret: "test-secret" }

describe("BinanceSdkConfig", () => {
  it("requires non-empty API credentials", () => {
    for (const input of [{}, { apiKey: "test-key" }, { apiKey: "", apiSecret: "test-secret" }, { apiKey: "test-key", apiSecret: "" }]) {
      assert.throws(() => new BinanceSdkConfig(input), /credentials are required/)
    }
  })

  it("uses the official WebSocket endpoints for the current mode", () => {
    const config = new BinanceSdkConfig(credentials)
    const endpoints = isProdMode ? BINANCE_WEBSOCKET_ENDPOINTS.production : BINANCE_WEBSOCKET_ENDPOINTS.testnet
    assert.equal(config.websocketApiUrl, endpoints.api)
    assert.equal(config.websocketStreamsUrl, endpoints.streams)
  })

  it("uses a default reconnect delay of 5000 ms", () => {
    assert.equal(new BinanceSdkConfig(credentials).reconnectDelay, 5000)
  })

  it("accepts a custom reconnect delay including zero", () => {
    assert.equal(new BinanceSdkConfig({ ...credentials, reconnectDelay: 1000 }).reconnectDelay, 1000)
    assert.equal(new BinanceSdkConfig({ ...credentials, reconnectDelay: 0 }).reconnectDelay, 0)
  })

  it("rejects invalid reconnect delays", () => {
    for (const reconnectDelay of [-1, 1.5, NaN, "5000"]) {
      assert.throws(() => new BinanceSdkConfig({ ...credentials, reconnectDelay }), /non-negative integer/)
    }
  })

  it("allows custom WebSocket URLs and preserves explicit null as default", () => {
    const custom = new BinanceSdkConfig({
      ...credentials,
      websocketApiUrl: "wss://example.com/api",
      websocketStreamsUrl: "wss://example.com/streams",
    })
    assert.equal(custom.websocketApiUrl, "wss://example.com/api")
    assert.equal(custom.websocketStreamsUrl, "wss://example.com/streams")

    const fallback = new BinanceSdkConfig({
      ...credentials,
      websocketApiUrl: null,
      websocketStreamsUrl: null,
    })
    const endpoints = isProdMode ? BINANCE_WEBSOCKET_ENDPOINTS.production : BINANCE_WEBSOCKET_ENDPOINTS.testnet
    assert.equal(fallback.websocketApiUrl, endpoints.api)
    assert.equal(fallback.websocketStreamsUrl, endpoints.streams)
  })
})
