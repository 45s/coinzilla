import test from "node:test"
import assert from "node:assert/strict"
import { resolveProviderConfiguration } from "./resolve-provider-configuration.js"

test("maps legacy configuration to one explicit Binance instance", () => {
  const result = resolveProviderConfiguration({
    tradingMode: "testnet",
  })
  assert.deepEqual(result.instances, [{
    id: "binancePrimary",
    provider: "binance",
    accountId: "binance-primary",
    tradingMode: "testnet",
  }], "Legacy configuration must resolve through one deterministic named-instance boundary.")
  assert.deepEqual(result.selections, {
    execution: "binancePrimary",
    account: "binancePrimary",
    marketData: "binancePrimary",
  }, "All current broker consumers must resolve to the same explicit instance.")
  assert.equal(result.legacyCompatibility, true)
})

test("resolves explicit instances without mutating loaded configuration", () => {
  const brokers = {
    instances: {
      binancePrimary: {
        provider: "binance",
        accountId: "primary",
      },
    },
    selection: {
      execution: "binancePrimary",
      account: "binancePrimary",
      marketData: "binancePrimary",
    },
  }
  const result = resolveProviderConfiguration({
    brokers,
    tradingMode: "live",
  })
  assert.equal(result.instances[0].tradingMode, "live")
  assert.equal(
    brokers.instances.binancePrimary.tradingMode,
    undefined,
    "Runtime mode must not mutate loaded configuration.",
  )
})

test("rejects secret values and unsupported provider configuration fields", () => {
  const brokers = {
    instances: {
      binancePrimary: {
        provider: "binance",
        accountId: "primary",
        credentialEnv: {
          apiKey: "private-secret-value",
          apiSecret: "BINANCE_API_SECRET_KEY",
        },
      },
    },
    selection: {
      execution: "binancePrimary",
      account: "binancePrimary",
      marketData: "binancePrimary",
    },
  }
  assert.throws(
    () => resolveProviderConfiguration({
      brokers,
      tradingMode: "testnet",
    }),
    /environment variable names/,
    "Provider configuration must contain environment references rather than credential values.",
  )
})

test("rejects missing or split provider selections", () => {
  const missing = {
    instances: {
      binancePrimary: {
        provider: "binance",
        accountId: "primary",
      },
    },
    selection: {
      execution: "missing",
      account: "binancePrimary",
      marketData: "binancePrimary",
    },
  }
  assert.throws(
    () => resolveProviderConfiguration({
      brokers: missing,
      tradingMode: "testnet",
    }),
    /must reference/,
  )
  const split = {
    instances: {
      binancePrimary: {
        provider: "binance",
        accountId: "primary",
      },
      binanceSecondary: {
        provider: "binance",
        accountId: "secondary",
      },
    },
    selection: {
      execution: "binancePrimary",
      account: "binanceSecondary",
      marketData: "binancePrimary",
    },
  }
  assert.throws(
    () => resolveProviderConfiguration({
      brokers: split,
      tradingMode: "testnet",
    }),
    /requires execution, account, and market data/,
  )
})

test("rejects account identifiers that could contain credentials", () => {
  const brokers = {
    instances: {
      binancePrimary: {
        provider: "binance",
        accountId: "BINANCE_API_KEY",
      },
    },
    selection: {
      execution: "binancePrimary",
      account: "binancePrimary",
      marketData: "binancePrimary",
    },
  }
  assert.throws(
    () => resolveProviderConfiguration({
      brokers,
      tradingMode: "testnet",
    }),
    /stable non-secret account ID/,
  )
})

test("allows provider-specific credential references without storing secret values", () => {
  const brokers = {
    instances: {
      bitunixPrimary: {
        provider: "bitunix",
        accountId: "bitunix-primary",
        credentialEnv: {
          apiKey: "BITUNIX_API_KEY",
          apiSecret: "BITUNIX_API_SECRET",
          apiPassphrase: "BITUNIX_API_PASSPHRASE",
        },
      },
    },
    selection: {
      execution: "bitunixPrimary",
      account: "bitunixPrimary",
      marketData: "bitunixPrimary",
    },
  }
  const configuration = resolveProviderConfiguration({
    brokers,
    tradingMode: "testnet",
  })
  assert.deepEqual(configuration.instances[0].credentialEnv, {
    apiKey: "BITUNIX_API_KEY",
    apiSecret: "BITUNIX_API_SECRET",
    apiPassphrase: "BITUNIX_API_PASSPHRASE",
  })
})

test("does not treat an explicitly null broker configuration as legacy configuration", () => {
  assert.throws(
    () => resolveProviderConfiguration({
      brokers: null,
      tradingMode: "testnet",
    }),
    /brokers.*must be an object/,
  )
})
