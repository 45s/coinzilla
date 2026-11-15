import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotConfig } from "./bitunix-spot-config.js"

test("BitunixSpotConfig requires explicit live mode and credentials", () => {
  assert.throws(() => new BitunixSpotConfig(), /credentials/i)
  assert.throws(() => new BitunixSpotConfig({
    apiKey: "key",
    apiSecret: "secret",
  }), /tradingMode/i)
  assert.throws(() => new BitunixSpotConfig({
    apiKey: "key",
    apiSecret: "secret",
    tradingMode: "testnet",
  }), /unsupported/i)
})

test("BitunixSpotConfig selects the documented Spot WebSocket API endpoint", () => {
  const config = new BitunixSpotConfig({
    apiKey: "key",
    apiSecret: "secret",
    tradingMode: "live",
  })

  assert.equal(config.websocketApiUrl, "wss://openapi.bitunix.com:443/ws-api/v1")
  assert.equal(config.tradingMode, "live")
  assert.equal(config.requestTimeout, 10_000)
})

test("BitunixSpotConfig validates explicit endpoint overrides and timeout", () => {
  assert.throws(() => new BitunixSpotConfig({
    apiKey: "key",
    apiSecret: "secret",
    tradingMode: "live",
    websocketApiUrl: "https://openapi.bitunix.com",
  }), /wss/i)
  assert.throws(() => new BitunixSpotConfig({
    apiKey: "key",
    apiSecret: "secret",
    tradingMode: "live",
    requestTimeout: 0,
  }), /requestTimeout/i)
})
