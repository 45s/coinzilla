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

function createDescriptor({ id = "binancePrimary", provider = "binance", accountId = "binance-primary", credentialEnv } = {}) {
  return {
    id,
    provider,
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

test("disconnects only the explicitly requested provider instance", async () => {
  const primaryCalls = []
  const secondaryCalls = []
  const brokers = [
    createBroker({
      calls: primaryCalls,
    }),
    createBroker({
      calls: secondaryCalls,
    }),
  ]
  const registry = await createProviderRegistry({
    providerInstances: [
      createDescriptor(),
      createDescriptor({
        id: "binanceSecondary",
        accountId: "secondary",
      }),
    ],
    selections,
    adapterFactories: {
      binance: () => brokers.shift(),
    },
    env: {
      BINANCE_API_KEY: "key",
      BINANCE_API_SECRET_KEY: "secret",
    },
  })
  const primary = registry.getBrokerPort({
    instanceId: "binancePrimary",
  })
  const secondary = registry.getBrokerPort({
    instanceId: "binanceSecondary",
  })
  await primary.connect()
  await secondary.connect()
  await primary.disconnect()
  assert.deepEqual(primaryCalls, ["connect", "disconnect"])
  assert.deepEqual(secondaryCalls, ["connect"])
  await registry.disconnectAll()
  assert.deepEqual(secondaryCalls, ["connect", "disconnect"])
})

test("an instance connection failure does not disconnect a sibling instance", async () => {
  const primaryCalls = []
  const secondaryCalls = []
  const connectError = new Error("primary connect failed")
  const brokers = [
    createBroker({
      calls: primaryCalls,
      connect: async () => {
        throw connectError
      },
    }),
    createBroker({
      calls: secondaryCalls,
    }),
  ]
  const registry = await createProviderRegistry({
    providerInstances: [
      createDescriptor(),
      createDescriptor({
        id: "binanceSecondary",
        accountId: "secondary",
      }),
    ],
    selections,
    adapterFactories: {
      binance: () => brokers.shift(),
    },
    env: {
      BINANCE_API_KEY: "key",
      BINANCE_API_SECRET_KEY: "secret",
    },
  })
  const primary = registry.getBrokerPort({
    instanceId: "binancePrimary",
  })
  await assert.rejects(primary.connect(), /primary connect failed/)
  assert.deepEqual(primaryCalls, ["connect", "disconnect"])
  assert.deepEqual(secondaryCalls, [])
})

test("constructs a registered non-Binance provider without provider-specific registry logic", async () => {
  const broker = createBroker()
  broker.capabilities = Object.freeze({
    ...capabilities,
    provider: "future-exchange",
  })
  const registry = await createProviderRegistry({
    providerInstances: [
      createDescriptor({
        id: "futureExchangePrimary",
        provider: "future-exchange",
        accountId: "future-exchange-primary",
      }),
    ],
    selections: {
      execution: "futureExchangePrimary",
      account: "futureExchangePrimary",
      marketData: "futureExchangePrimary",
    },
    adapterFactories: {
      "future-exchange": () => broker,
    },
    env: {},
  })
  assert.equal(registry.getDescriptor({
    instanceId: "futureExchangePrimary",
  }).provider, "future-exchange")
  assert.equal(registry.getBrokerPort({
    instanceId: "futureExchangePrimary",
  }).providerInstanceId, "futureExchangePrimary")
})
