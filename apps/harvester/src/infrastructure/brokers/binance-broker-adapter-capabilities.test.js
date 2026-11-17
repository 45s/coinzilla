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

const createCapabilities = ({ selectedMode = "testnet" } = {}) => Object.freeze({
  contractVersion: 1,
  provider: "binance",
  product: "spot",
  environment: Object.freeze({
    selector: "tradingMode",
    supportedModes: Object.freeze(["testnet", "live"]),
    selectedMode,
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

test("[binance-broker-adapter-capabilities.test.js] rejects a capability declaration for a different trading environment", () => {
  const capabilities = createCapabilities({ selectedMode: "testnet" })

  assert.throws(
    () => createBinanceBrokerAdapter({
      config: {
        ...config,
        tradingMode: "live",
      },
      brokerFactory: () => createClient({ capabilities }),
    }),
    /capability declaration.*tradingMode/i,
    "A provider capability snapshot must match the explicit Binance endpoint environment.",
  )
})

test("[binance-broker-adapter-capabilities.test.js] leaves missing capability rejection to the provider registry", () => {
  const broker = createBinanceBrokerAdapter({
    config,
    brokerFactory: () => createClient(),
  })

  assert.equal(broker.capabilities, undefined,
    "The adapter must not fabricate capability declarations when a client omits the #1366 contract.")
})
