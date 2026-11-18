import assert from "node:assert/strict"
import test from "node:test"
import { resolveProviderInstances } from "./resolve-provider-instances.js"

function createAdapterFactories(calls = []) {
  return {
    binance: (input) => {
      calls.push({
        provider: "binance",
        ...input,
      })
      return Object.freeze({
        provider: "binance",
      })
    },
    "bitunix-spot": (input) => {
      calls.push({
        provider: "bitunix-spot",
        ...input,
      })
      return Object.freeze({
        provider: "bitunix-spot",
      })
    },
  }
}

function createProviderConfig(overrides = {}) {
  return {
    providerInstanceId: "binanceTestnetPrimary",
    providerType: "binance",
    accountId: "binance-primary",
    environment: "testnet",
    credentials: {
      apiKeyEnv: "BINANCE_API_KEY",
      apiSecretEnv: "BINANCE_API_SECRET_KEY",
    },
    ...overrides,
  }
}

test("preserves the legacy single-Binance environment configuration", () => {
  const calls = []
  const [provider] = resolveProviderInstances({
    appConfig: {},
    env: {
      TRADING_MODE: "testnet",
      BINANCE_API_KEY: "primary-key",
      BINANCE_API_SECRET_KEY: "primary-secret",
    },
    adapterFactories: createAdapterFactories(calls),
  })

  assert.deepEqual({
    providerInstanceId: provider.providerInstanceId,
    providerType: provider.providerType,
    accountId: provider.accountId,
    environment: provider.environment,
  }, {
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "binance-primary",
    environment: "testnet",
  })
  provider.brokerAdapterFactory({ config: {} })
  assert.equal(calls[0].config.apiKey, "primary-key")
  assert.equal(calls[0].config.apiSecret, "primary-secret")
  assert.equal(calls[0].config.tradingMode, "testnet")
})

test("constructs multiple independent accounts using the same provider", () => {
  const calls = []
  const providers = resolveProviderInstances({
    appConfig: {
      brokers: {
        instances: [
          createProviderConfig(),
          createProviderConfig({
            providerInstanceId: "binanceTestnetSecondary",
            accountId: "binance-secondary",
            credentials: {
              apiKeyEnv: "BINANCE_SECONDARY_API_KEY",
              apiSecretEnv: "BINANCE_SECONDARY_API_SECRET",
            },
          }),
        ],
      },
    },
    env: {
      BINANCE_API_KEY: "primary-key",
      BINANCE_API_SECRET_KEY: "primary-secret",
      BINANCE_SECONDARY_API_KEY: "secondary-key",
      BINANCE_SECONDARY_API_SECRET: "secondary-secret",
    },
    adapterFactories: createAdapterFactories(calls),
  })

  assert.equal(providers.length, 2)
  assert.notEqual(providers[0].providerInstanceId, providers[1].providerInstanceId)
  assert.notEqual(providers[0].accountId, providers[1].accountId)
  providers[0].brokerAdapterFactory({ config: {} })
  providers[1].brokerAdapterFactory({ config: {} })
  assert.deepEqual(calls.map(({ config }) => [config.apiKey, config.apiSecret]), [
    ["primary-key", "primary-secret"],
    ["secondary-key", "secondary-secret"],
  ])
  assert.equal(JSON.stringify(providers).includes("primary-secret"), false)
  assert.equal(JSON.stringify(providers).includes("secondary-secret"), false)
})

test("constructs accounts from different registered provider types", () => {
  const calls = []
  const providers = resolveProviderInstances({
    appConfig: {
      brokers: {
        instances: [
          createProviderConfig(),
          createProviderConfig({
            providerInstanceId: "bitunixSpotPrimary",
            providerType: "bitunix-spot",
            accountId: "bitunix-primary",
            environment: "live",
            credentials: {
              apiKeyEnv: "BITUNIX_API_KEY",
              apiSecretEnv: "BITUNIX_API_SECRET",
            },
          }),
        ],
      },
    },
    env: {
      BINANCE_API_KEY: "binance-key",
      BINANCE_API_SECRET_KEY: "binance-secret",
      BITUNIX_API_KEY: "bitunix-key",
      BITUNIX_API_SECRET: "bitunix-secret",
    },
    adapterFactories: createAdapterFactories(calls),
  })

  assert.deepEqual(providers.map(({ providerType, environment }) => [providerType, environment]), [
    ["binance", "testnet"],
    ["bitunix-spot", "live"],
  ])
  providers[0].brokerAdapterFactory({ config: {} })
  providers[1].brokerAdapterFactory({ config: {} })
  assert.deepEqual(calls.map(({ provider, config }) => [provider, config.apiKey]), [
    ["binance", "binance-key"],
    ["bitunix-spot", "bitunix-key"],
  ])
})

test("rejects duplicate provider instance identifiers", () => {
  assert.throws(() => resolveProviderInstances({
    appConfig: {
      brokers: {
        instances: [
          createProviderConfig(),
          createProviderConfig({ accountId: "another-account" }),
        ],
      },
    },
    env: {},
    adapterFactories: createAdapterFactories(),
  }), /duplicate providerInstanceId/)
})

test("rejects duplicate provider account and environment ownership", () => {
  assert.throws(() => resolveProviderInstances({
    appConfig: {
      brokers: {
        instances: [
          createProviderConfig(),
          createProviderConfig({ providerInstanceId: "binanceTestnetAlias" }),
        ],
      },
    },
    env: {},
    adapterFactories: createAdapterFactories(),
  }), /duplicate provider account identity/)
})

test("rejects unsupported provider types before constructing an adapter", () => {
  assert.throws(() => resolveProviderInstances({
    appConfig: {
      brokers: {
        instances: [
          createProviderConfig({ providerType: "unknown-exchange" }),
        ],
      },
    },
    env: {},
    adapterFactories: createAdapterFactories(),
  }), /unsupported provider type/)
})

test("rejects invalid account environment and credential environment names", () => {
  assert.throws(() => resolveProviderInstances({
    appConfig: {
      brokers: {
        instances: [createProviderConfig({ environment: "paper" })],
      },
    },
    env: {},
    adapterFactories: createAdapterFactories(),
  }), /environment must be testnet or live/)

  assert.throws(() => resolveProviderInstances({
    appConfig: {
      brokers: {
        instances: [createProviderConfig({
          credentials: {
            apiKeyEnv: "BINANCE-API-KEY",
            apiSecretEnv: "BINANCE_API_SECRET_KEY",
          },
        })],
      },
    },
    env: {},
    adapterFactories: createAdapterFactories(),
  }), /credential environment variable name/)
})

test("fails clearly when an account credential is missing", () => {
  const [provider] = resolveProviderInstances({
    appConfig: {
      brokers: {
        instances: [createProviderConfig()],
      },
    },
    env: { BINANCE_API_KEY: "key" },
    adapterFactories: createAdapterFactories(),
  })

  assert.throws(
    () => provider.brokerAdapterFactory({ config: {} }),
    /binanceTestnetPrimary.*BINANCE_API_SECRET_KEY/,
  )
})


test("rejects credential environment variable reuse across account identities", () => {
  assert.throws(() => resolveProviderInstances({
    appConfig: {
      brokers: {
        instances: [
          createProviderConfig(),
          createProviderConfig({
            providerInstanceId: "binanceTestnetSecondary",
            accountId: "binance-secondary",
            credentials: {
              apiKeyEnv: "BINANCE_API_KEY",
              apiSecretEnv: "BINANCE_SECONDARY_API_SECRET",
            },
          }),
        ],
      },
    },
    env: {},
    adapterFactories: createAdapterFactories(),
  }), /reuses credential environment variable BINANCE_API_KEY/)
})
