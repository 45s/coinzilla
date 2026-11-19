import assert from "node:assert/strict"
import test from "node:test"

import { BitunixFuturesConfig } from "./config.js"

test("Bitunix Futures config defaults to the official live endpoint and keeps all mutations disabled", () => {
  const config = new BitunixFuturesConfig()

  assert.equal(config.baseUrl, "https://fapi.bitunix.com")
  assert.equal(config.language, "en-US")
  assert.equal(config.allowLiveOrderMutations, false)
  assert.equal(config.allowLivePositionMutations, false)
  assert.equal(config.allowLiveAccountMutations, false)
  assert.equal(config.allowLiveFundsMutations, false)
  assert.equal(config.hasCredentials, false)
})

test("Bitunix Futures config accepts a complete API key pair for private reads", () => {
  const config = new BitunixFuturesConfig({
    apiKey: "api-key",
    apiSecret: "api-secret",
  })

  assert.equal(config.hasCredentials, true)
  assert.equal(config.apiKey, "api-key")
  assert.equal(config.apiSecret, "api-secret")
})

test("Bitunix Futures config rejects a partial credential pair", () => {
  assert.throws(
    () => new BitunixFuturesConfig({ apiKey: "api-key" }),
    /apiKey and apiSecret must be supplied together/,
  )
})

test("Bitunix Futures config rejects insecure REST and WebSocket endpoints", () => {
  assert.throws(
    () => new BitunixFuturesConfig({ baseUrl: "http://fapi.bitunix.com" }),
    /HTTPS/,
  )
  assert.throws(
    () => new BitunixFuturesConfig({ publicWebSocketUrl: "ws://fapi.bitunix.com/public/" }),
    /WSS/,
  )
})

test("Bitunix Futures config validates every independent mutation safety flag", () => {
  assert.throws(
    () => new BitunixFuturesConfig({ allowLiveOrderMutations: 1 }),
    /allowLiveOrderMutations must be a boolean/,
  )
  assert.throws(
    () => new BitunixFuturesConfig({ allowLivePositionMutations: 1 }),
    /allowLivePositionMutations must be a boolean/,
  )
  assert.throws(
    () => new BitunixFuturesConfig({ allowLiveAccountMutations: 1 }),
    /allowLiveAccountMutations must be a boolean/,
  )
  assert.throws(
    () => new BitunixFuturesConfig({ allowLiveFundsMutations: 1 }),
    /allowLiveFundsMutations must be a boolean/,
  )
})
