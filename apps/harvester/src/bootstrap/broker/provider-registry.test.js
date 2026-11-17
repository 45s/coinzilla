import test from "node:test"
import assert from "node:assert/strict"
import { createProviderRegistry } from "./provider-registry.js"

const capabilities = {
  contractVersion: 1, provider: "binance",
  marketData: {
    priceStream: { status: "supported" }, bookTickerStream: { status: "supported" },
    candleHistory: { status: "supported" }, candleStream: { status: "supported" },
  },
  account: { snapshot: { status: "supported" } },
  orders: {
    openOrders: { status: "supported" }, placement: { status: "environment-dependent" },
    cancellation: { status: "environment-dependent" },
  },
  fills: { canonicalHistory: { status: "supported" }, executionUpdates: { status: "supported" } },
  userData: { stream: { status: "supported" } }, recovery: { sameProcess: { status: "supported" } },
}
const descriptor = (id = "binancePrimary") => ({
  id, provider: "binance", accountId: "binance-primary", tradingMode: "testnet",
})
const selections = { execution: "binancePrimary", account: "binancePrimary", marketData: "binancePrimary" }
function createBroker(calls, connect, disconnect) {
  const methods = [
    "placeOrder", "cancelOrder", "getOpenOrders", "getFills", "getCanonicalOrderHistory",
    "getCanonicalOrder", "getAccountSnapshot", "getSymbolFilters", "getExchangeMarkets",
    "getPrices", "getCandles", "subscribeForPrices", "subscribeForCandles",
    "subscribeForBookTicker", "subscribeForUserData",
  ]
  const broker = Object.fromEntries(methods.map((method) => [method, async () => ({ ok: true, data: {} })]))
  broker.capabilities = capabilities
  broker.connect = async () => { calls.push("connect"); await connect?.() }
  broker.disconnect = async () => { calls.push("disconnect"); await disconnect?.() }
  return broker
}
function createRegistry({ brokers = [], instances = [descriptor()], selected = selections } = {}) {
  const calls = []
  return createProviderRegistry({
    providerInstances: instances, selections: selected,
    adapterFactories: { binance: () => brokers.shift() ?? createBroker(calls) },
    env: { BINANCE_API_KEY: "key", BINANCE_API_SECRET_KEY: "secret" },
  }).then((registry) => ({ registry, calls }))
}

test("constructs named instances and exposes safe descriptors", async () => {
  const { registry } = await createRegistry()
  assert.deepEqual(registry.descriptors, [descriptor()], "Descriptors must contain stable non-secret provider identity only.")
  assert.equal(registry.getDescriptor({ instanceId: "binancePrimary" }).accountId, "binance-primary")
})

test("rejects duplicate instance IDs before adapter construction", async () => {
  let factoryCalls = 0
  await assert.rejects(createProviderRegistry({
    providerInstances: [descriptor(), descriptor()], selections,
    adapterFactories: { binance: () => { factoryCalls += 1; return createBroker([]) } },
    env: { BINANCE_API_KEY: "key", BINANCE_API_SECRET_KEY: "secret" },
  }), /Duplicate provider instance ID/)
  assert.equal(factoryCalls, 0, "Duplicate IDs must fail before constructing clients.")
})

test("rejects unknown providers without Binance fallback", async () => {
  await assert.rejects(createProviderRegistry({
    providerInstances: [{ id: "other", provider: "unknown", accountId: "other-account" }],
    selections: { execution: "other", account: "other", marketData: "other" },
    adapterFactories: { binance: () => createBroker([]) }, env: {},
  }), /not registered/)
})

test("rejects a missing capability declaration", async () => {
  const broker = createBroker([])
  broker.capabilities = undefined
  await assert.rejects(createRegistry({ brokers: [broker] }), /capability declaration/)
})

test("rejects missing credentials without exposing credential values", async () => {
  await assert.rejects(createProviderRegistry({
    providerInstances: [descriptor()], selections,
    adapterFactories: { binance: () => createBroker([]) }, env: { BINANCE_API_KEY: "secret-value" },
  }), (error) => error.message.includes("API secret") && !error.message.includes("secret-value"))
})

test("rejects a provider whose declared required capability is unknown", async () => {
  const broker = createBroker([])
  broker.capabilities = { ...capabilities, account: { snapshot: { status: "unknown" } } }
  await assert.rejects(createRegistry({ brokers: [broker] }), /account.snapshot/)
})

test("resolves separate credentials for same-provider instances without storing secrets in descriptors", async () => {
  const received = []
  const registry = await createProviderRegistry({
    providerInstances: [
      { ...descriptor(), credentialEnv: { apiKey: "PRIMARY_KEY", apiSecret: "PRIMARY_SECRET" } },
      { ...descriptor("binanceSecondary"), accountId: "binance-secondary", credentialEnv: { apiKey: "SECONDARY_KEY", apiSecret: "SECONDARY_SECRET" } },
    ],
    selections,
    adapterFactories: { binance: ({ config }) => { received.push(config); return createBroker([]) } },
    env: { PRIMARY_KEY: "primary-key", PRIMARY_SECRET: "primary-secret", SECONDARY_KEY: "secondary-key", SECONDARY_SECRET: "secondary-secret" },
  })
  assert.deepEqual(received.map(({ apiKey, apiSecret }) => [apiKey, apiSecret]), [
    ["primary-key", "primary-secret"], ["secondary-key", "secondary-secret"],
  ])
  assert.equal(JSON.stringify(registry.descriptors).includes("primary-secret"), false, "Registry descriptors must never expose credentials.")
})

test("connects and disconnects each instance once", async () => {
  const { registry, calls } = await createRegistry()
  const broker = registry.getBrokerPort({ instanceId: "binancePrimary" })
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
    providerInstances: [descriptor()], selections,
    adapterFactories: { binance: () => createBroker(calls, async () => { throw connectError }, async () => { throw disconnectError }) },
    env: { BINANCE_API_KEY: "key", BINANCE_API_SECRET_KEY: "secret" },
  })
  await assert.rejects(registry.connectAll(), (error) =>
    error instanceof AggregateError && error.errors.includes(connectError) &&
    error.errors.some((nested) => nested instanceof AggregateError && nested.errors.includes(disconnectError)),
    "Connection and cleanup failures must both be preserved.",
  )
})
