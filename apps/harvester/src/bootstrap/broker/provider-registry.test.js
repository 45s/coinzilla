import test from "node:test"
import assert from "node:assert/strict"
import { createProviderRegistry } from "./provider-registry.js"

const capabilities = Object.freeze({
  contractVersion: 1,
  provider: "binance",
  marketData: Object.freeze({
    oneShotPrice: Object.freeze({ status: "supported" }),
    priceStream: Object.freeze({ status: "supported" }),
    bookTickerStream: Object.freeze({ status: "supported" }),
    candleHistory: Object.freeze({ status: "supported" }),
    candleStream: Object.freeze({ status: "supported" }),
  }),
  account: Object.freeze({
    snapshot: Object.freeze({ status: "supported" }),
  }),
  orders: Object.freeze({
    openOrders: Object.freeze({ status: "supported" }),
    canonicalLookup: Object.freeze({ status: "supported" }),
    canonicalHistory: Object.freeze({ status: "supported" }),
    placement: Object.freeze({ status: "environment-dependent" }),
    cancellation: Object.freeze({ status: "environment-dependent" }),
  }),
  fills: Object.freeze({
    canonicalHistory: Object.freeze({ status: "supported" }),
    executionUpdates: Object.freeze({ status: "supported" }),
  }),
  userData: Object.freeze({
    stream: Object.freeze({ status: "supported" }),
  }),
  recovery: Object.freeze({
    sameProcess: Object.freeze({ status: "supported" }),
  }),
})

function createDescriptor({ id = "binancePrimary", accountId = "binance-primary", credentialEnv } = {}) {
  return {
    id,
    provider: "binance",
    accountId,
    tradingMode: "testnet",
    ...(credentialEnv ? { credentialEnv } : {}),
  }
}

const selections = Object.freeze({
  execution: "binancePrimary",
  account: "binancePrimary",
  marketData: "binancePrimary",
})

function createBroker({ calls = [], connect, disconnect } = {}) {
  const methodNames = [
    "placeOrder",
    "cancelOrder",
    "getOpenOrders",
    "getFills",
    "getCanonicalOrderHistory",
    "getCanonicalOrder",
    "getAccountSnapshot",
    "getSymbolFilters",
    "getExchangeMarkets",
    "getPrices",
    "getCandles",
    "subscribeForPrices",
    "subscribeForCandles",
    "subscribeForBookTicker",
    "subscribeForUserData",
  ]
  const broker = Object.fromEntries(methodNames.map((method) => [
    method,
    async () => ({
      ok: true,
      data: {},
    }),
  ]))
  broker.capabilities = capabilities
  broker.connect = async () => {
    calls.push("connect")
    await connect?.()
  }
  broker.disconnect = async () => {
    calls.push("disconnect")
    await disconnect?.()
  }
  return broker
}

async function createRegistry({ brokers = [], instances = [createDescriptor()], selected = selections } = {}) {
  const calls = []
  const registry = await createProviderRegistry({
    providerInstances: instances,
    selections: selected,
    adapterFactories: {
      binance: () => brokers.shift() ?? createBroker({
        calls,
      }),
    },
    env: {
      BINANCE_API_KEY: "key",
      BINANCE_API_SECRET_KEY: "secret",
    },
  })
  return {
    registry,
    calls,
  }
}

function containsConnectionAndCleanupFailures({ error, connectError, disconnectError }) {
  return error instanceof AggregateError &&
    error.errors.includes(connectError) &&
    error.errors.some((nested) =>
      nested instanceof AggregateError && nested.errors.includes(disconnectError))
}

test("constructs named instances and exposes safe descriptors", async () => {
  const { registry } = await createRegistry()
  assert.deepEqual(registry.descriptors, [createDescriptor()], "Descriptors must contain stable non-secret provider identity only.")
  assert.equal(registry.getDescriptor({
    instanceId: "binancePrimary",
  }).accountId, "binance-primary")
  assert.equal(registry.getCapabilities({
    instanceId: "binancePrimary",
  }), capabilities, "The registry must expose the verified declaration for explicit capability gating.")
})

test("rejects duplicate instance IDs before adapter construction", async () => {
  let factoryCalls = 0
  await assert.rejects(createProviderRegistry({
    providerInstances: [
      createDescriptor(),
      createDescriptor(),
    ],
    selections,
    adapterFactories: {
      binance: () => {
        factoryCalls += 1
        return createBroker()
      },
    },
    env: {
      BINANCE_API_KEY: "key",
      BINANCE_API_SECRET_KEY: "secret",
    },
  }), /Duplicate provider instance ID/)
  assert.equal(factoryCalls, 0, "Duplicate IDs must fail before constructing clients.")
})

test("rejects unknown providers without Binance fallback", async () => {
  await assert.rejects(createProviderRegistry({
    providerInstances: [{
      id: "other",
      provider: "unknown",
      accountId: "other-account",
    }],
    selections: {
      execution: "other",
      account: "other",
      marketData: "other",
    },
    adapterFactories: {
      binance: () => createBroker(),
    },
    env: {},
  }), /not registered/)
})

test("rejects missing credentials without exposing credential values", async () => {
  await assert.rejects(createProviderRegistry({
    providerInstances: [createDescriptor()],
    selections,
    adapterFactories: {
      binance: () => createBroker(),
    },
    env: {
      BINANCE_API_KEY: "secret-value",
    },
  }), (error) => error.message.includes("API secret") && !error.message.includes("secret-value"))
})

test("rejects a missing capability declaration", async () => {
  const broker = createBroker()
  broker.capabilities = undefined
  await assert.rejects(createRegistry({
    brokers: [broker],
  }), /capability declaration/)
})

test("rejects an unknown required capability", async () => {
  const broker = createBroker()
  broker.capabilities = {
    ...capabilities,
    account: {
      snapshot: {
        status: "unknown",
      },
    },
  }
  await assert.rejects(createRegistry({
    brokers: [broker],
  }), /account.snapshot/)
})

test("resolves separate credentials for same-provider instances without exposing secrets", async () => {
  const receivedConfigs = []
  const registry = await createProviderRegistry({
    providerInstances: [
      createDescriptor({
        credentialEnv: {
          apiKey: "PRIMARY_KEY",
          apiSecret: "PRIMARY_SECRET",
        },
      }),
      createDescriptor({
        id: "binanceSecondary",
        accountId: "binance-secondary",
        credentialEnv: {
          apiKey: "SECONDARY_KEY",
          apiSecret: "SECONDARY_SECRET",
        },
      }),
    ],
    selections,
    adapterFactories: {
      binance: ({ config }) => {
        receivedConfigs.push(config)
        return createBroker()
      },
    },
    env: {
      PRIMARY_KEY: "primary-key",
      PRIMARY_SECRET: "primary-secret",
      SECONDARY_KEY: "secondary-key",
      SECONDARY_SECRET: "secondary-secret",
    },
  })
  assert.deepEqual(receivedConfigs.map((config) => [config.apiKey, config.apiSecret]), [
    ["primary-key", "primary-secret"],
    ["secondary-key", "secondary-secret"],
  ])
  assert.equal(JSON.stringify(registry.descriptors).includes("primary-secret"), false)
})

test("connects and disconnects each instance once", async () => {
  const { registry, calls } = await createRegistry()
  const broker = registry.getBrokerPort({
    instanceId: "binancePrimary",
  })
  await broker.connect()
  await registry.connectAll()
  await broker.disconnect()
  await registry.disconnectAll()
  assert.deepEqual(calls, ["connect", "disconnect"], "Registry lifecycle operations must be idempotent.")
})

test("preserves connection and cleanup failures", async () => {
  const calls = []
  const connectError = new Error("connect failed")
  const disconnectError = new Error("disconnect failed")
  const registry = await createProviderRegistry({
    providerInstances: [createDescriptor()],
    selections,
    adapterFactories: {
      binance: () => createBroker({
        calls,
        connect: async () => {
          throw connectError
        },
        disconnect: async () => {
          throw disconnectError
        },
      }),
    },
    env: {
      BINANCE_API_KEY: "key",
      BINANCE_API_SECRET_KEY: "secret",
    },
  })
  await assert.rejects(registry.connectAll(), (error) =>
    containsConnectionAndCleanupFailures({
      error,
      connectError,
      disconnectError,
    }))
})
