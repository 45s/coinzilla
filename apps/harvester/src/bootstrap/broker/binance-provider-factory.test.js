import test from "node:test"
import assert from "node:assert/strict"
import {
  createBinanceProviderFactory,
  resolveBinanceProviderConfig,
} from "./binance-provider-factory.js"

const descriptor = Object.freeze({
  id: "binancePrimary",
  provider: "binance",
  accountId: "binance-primary",
  tradingMode: "testnet",
})

test("resolves Binance credentials from explicit environment references", () => {
  const config = resolveBinanceProviderConfig({
    descriptor: {
      ...descriptor,
      credentialEnv: {
        apiKey: "PRIMARY_KEY",
        apiSecret: "PRIMARY_SECRET",
      },
    },
    env: {
      PRIMARY_KEY: "primary-key",
      PRIMARY_SECRET: "primary-secret",
    },
  })
  assert.deepEqual(config, {
    apiKey: "primary-key",
    apiSecret: "primary-secret",
    tradingMode: "testnet",
  })
})

test("rejects missing credentials without exposing secret values", () => {
  assert.throws(
    () => resolveBinanceProviderConfig({
      descriptor,
      env: {
        BINANCE_API_KEY: "public-key",
      },
    }),
    /API secret environment variable/,
  )
})

test("resolves distinct credentials for multiple Binance accounts", () => {
  const primary = resolveBinanceProviderConfig({
    descriptor: {
      ...descriptor,
      credentialEnv: {
        apiKey: "PRIMARY_KEY",
        apiSecret: "PRIMARY_SECRET",
      },
    },
    env: {
      PRIMARY_KEY: "primary-key",
      PRIMARY_SECRET: "primary-secret",
      SECONDARY_KEY: "secondary-key",
      SECONDARY_SECRET: "secondary-secret",
    },
  })
  const secondary = resolveBinanceProviderConfig({
    descriptor: {
      ...descriptor,
      id: "binanceSecondary",
      accountId: "secondary",
      credentialEnv: {
        apiKey: "SECONDARY_KEY",
        apiSecret: "SECONDARY_SECRET",
      },
    },
    env: {
      PRIMARY_KEY: "primary-key",
      PRIMARY_SECRET: "primary-secret",
      SECONDARY_KEY: "secondary-key",
      SECONDARY_SECRET: "secondary-secret",
    },
  })
  assert.notEqual(primary.apiKey, secondary.apiKey)
  assert.notEqual(primary.apiSecret, secondary.apiSecret)
})

test("provider factory delegates construction with resolved configuration", () => {
  const received = []
  const factory = createBinanceProviderFactory({
    brokerAdapterFactory: ({ config, logger }) => {
      received.push({
        config,
        logger,
      })
      return {
        adapter: true,
      }
    },
  })
  const logger = {
    info() {},
  }
  const adapter = factory({
    descriptor,
    env: {
      BINANCE_API_KEY: "key",
      BINANCE_API_SECRET_KEY: "secret",
    },
    logger,
  })
  assert.deepEqual(adapter, {
    adapter: true,
  })
  assert.equal(received[0].config.apiKey, "key")
  assert.equal(received[0].config.apiSecret, "secret")
  assert.equal(received[0].logger, logger)
})
