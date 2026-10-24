import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  SPOT_WS_API_PROD_URL,
  SPOT_WS_API_TESTNET_URL,
  SPOT_WS_STREAMS_PROD_URL,
  SPOT_WS_STREAMS_TESTNET_URL,
} from "@binance/spot"
import { isProdMode } from "@coinzilla/utils"
import { BinanceSdkConfig } from "./binance-sdk-config.js"

const credentials = {
  apiKey: "test-key",
  apiSecret: "test-secret",
}

describe("BinanceSdkConfig", () => {
  it("requires API credentials", () => {
    assert.throws(
      () => new BinanceSdkConfig({}),
      /Binance API credentials are required/,
    )

    assert.throws(
      () => new BinanceSdkConfig({ apiKey: "test-key" }),
      /Binance API credentials are required/,
    )
  })

  it("uses the correct URLs for the current mode", () => {
    const config = new BinanceSdkConfig(credentials)

    assert.equal(
      config.websocketApiUrl,
      isProdMode ? SPOT_WS_API_PROD_URL : SPOT_WS_API_TESTNET_URL,
    )

    assert.equal(
      config.websocketStreamsUrl,
      isProdMode ? SPOT_WS_STREAMS_PROD_URL : SPOT_WS_STREAMS_TESTNET_URL,
    )
  })

  it("uses a default reconnect delay of 5000 ms", () => {
    const config = new BinanceSdkConfig(credentials)

    assert.equal(config.reconnectDelay, 5000)
  })

  it("accepts a custom reconnect delay", () => {
    const config = new BinanceSdkConfig({
      ...credentials,
      reconnectDelay: 1000,
    })

    assert.equal(config.reconnectDelay, 1000)
  })

  it("allows a reconnect delay of zero", () => {
    const config = new BinanceSdkConfig({
      ...credentials,
      reconnectDelay: 0,
    })

    assert.equal(config.reconnectDelay, 0)
  })

  it("rejects invalid reconnect delays", () => {
    for (const reconnectDelay of [-1, 1.5, NaN, "5000"]) {
      assert.throws(
        () =>
          new BinanceSdkConfig({
            ...credentials,
            reconnectDelay,
          }),
        /reconnectDelay must be a non-negative integer/,
      )
    }
  })

  it("allows custom WebSocket URLs", () => {
    const config = new BinanceSdkConfig({
      ...credentials,
      websocketApiUrl: "wss://example.com/api",
      websocketStreamsUrl: "wss://example.com/streams",
    })

    assert.equal(config.websocketApiUrl, "wss://example.com/api")
    assert.equal(config.websocketStreamsUrl, "wss://example.com/streams")
  })
})
