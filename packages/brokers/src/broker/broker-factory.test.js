import assert from "node:assert/strict"
import test from "node:test"

import {
  BinanceWebSocketBroker,
  BitunixSpotBroker,
  Broker,
} from "../index.js"

const credentials = {
  apiKey: "broker-factory-test-key",
  apiSecret: "broker-factory-test-secret",
}

test("Broker selects Binance while preserving its concrete implementation", () => {
  const broker = new Broker({
    provider: "binance",
    ...credentials,
    tradingMode: "testnet",
  })

  assert.ok(broker instanceof BinanceWebSocketBroker, "Binance provider selection must return the existing Binance implementation")
  assert.ok(broker instanceof Broker, "the exchange-neutral constructor must recognize its returned provider instance")
  assert.equal(broker.capabilities.provider, "binance", "the selected Binance implementation must retain its provider capability declaration")
})

test("Broker selects Bitunix Spot while preserving its concrete implementation", () => {
  const broker = new Broker({
    provider: "bitunix",
    ...credentials,
    tradingMode: "live",
  })

  assert.ok(broker instanceof BitunixSpotBroker, "Bitunix provider selection must return the existing Spot implementation")
  assert.ok(broker instanceof Broker, "the exchange-neutral constructor must recognize its returned provider instance")
  assert.equal(broker.capabilities.provider, "bitunix", "the selected Bitunix implementation must retain its provider capability declaration")
})

test("Broker rejects a missing or unsupported provider before constructing an exchange client", () => {
  assert.throws(
    () => new Broker(credentials),
    {
      name: "TypeError",
      message: /provider must be either "binance" or "bitunix"/,
    },
    "a missing provider must fail with an actionable configuration error",
  )
  assert.throws(
    () => new Broker({
      provider: "unknown",
      ...credentials,
    }),
    {
      name: "TypeError",
      message: /provider must be either "binance" or "bitunix"/,
    },
    "an unsupported provider must fail instead of silently selecting an exchange",
  )
})

test("Broker requires explicit provider environment configuration", () => {
  assert.throws(
    () => new Broker({
      provider: "binance",
      ...credentials,
    }),
    /tradingMode must be set to "testnet" or "live"/,
    "Binance endpoint selection must remain explicit and independent of NODE_ENV",
  )
  assert.throws(
    () => new Broker({
      provider: "bitunix",
      ...credentials,
    }),
    /tradingMode is unsupported unless explicitly set to "live"/,
    "Bitunix Spot must not silently infer LIVE because no Spot TESTNET is documented",
  )
})

test("Broker forwards provider options without rewriting provider configuration", () => {
  const broker = new Broker({
    provider: "bitunix",
    ...credentials,
    tradingMode: "live",
    baseUrl: "https://spot.example.test",
    requestTimeout: 2500,
  })

  assert.equal(broker.config.baseUrl, "https://spot.example.test", "Bitunix-specific REST configuration must reach the existing provider config")
  assert.equal(broker.config.requestTimeout, 2500, "provider request timeout must remain unchanged")
})
