import test from "node:test"
import assert from "node:assert/strict"
import { createBinanceBrokerAdapter } from "./binance-broker-adapter.js"

const CLIENT_METHODS = [
  "connect",
  "disconnect",
  "createOrder",
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

const config = Object.freeze({
  apiKey: "test-key",
  apiSecret: "test-secret",
  tradingMode: "testnet",
})

const createCapabilities = () => Object.freeze({
  contractVersion: 1,
  provider: "binance",
  product: "spot",
  environment: Object.freeze({
    selector: "tradingMode",
    supportedModes: Object.freeze(["testnet", "live"]),
    selectedMode: "testnet",
    nodeEnvSelectsEndpoint: false,
  }),
})

function createClient({ capabilities } = {}) {
  const client = Object.fromEntries(CLIENT_METHODS.map((method) => [
    method,
    async () => undefined,
  ]))
  if (capabilities !== undefined) {
    client.capabilities = capabilities
  }
  return client
}

test("[binance-broker-adapter-capabilities.test.js] forwards the immutable #1366 capability declaration", () => {
  const capabilities = createCapabilities()
  const broker = createBinanceBrokerAdapter({
    config,
    brokerFactory: () => createClient({ capabilities }),
  })

  assert.equal(broker.capabilities, capabilities,
    "The Harvester adapter must forward the exact capability declaration created by the Binance broker.")
  assert.equal(Object.isFrozen(broker.capabilities), true,
    "The adapter must preserve the broker package's immutable capability contract.")
})

test("[binance-broker-adapter-capabilities.test.js] does not fabricate a capability declaration when the client omits it", () => {
  const broker = createBinanceBrokerAdapter({
    config,
    brokerFactory: () => createClient(),
  })

  assert.equal(broker.capabilities, undefined,
    "The adapter must leave a missing capability declaration absent so the provider registry can fail closed.")
})
