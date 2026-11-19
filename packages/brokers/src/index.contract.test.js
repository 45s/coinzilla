import assert from "node:assert/strict"
import test from "node:test"

import * as brokers from "./index.js"

test("package entry point exposes only the supported public contracts", () => {
  assert.deepEqual(Object.keys(brokers).sort(), [
    "BROKER_CAPABILITY_STATUSES",
    "BROKER_CAPABILITY_TYPES",
    "BROKER_COMPATIBILITY_METHODS",
    "BROKER_METHODS",
    "BROKER_MUTATION_OUTCOMES",
    "Broker",
    "BinanceWebSocketBroker",
    "BinanceWebSocketConfig",
    "BitunixSpotBroker",
    "BitunixSpotConfig",
    "BitunixSpotWebSocketClient",
    "BitunixWebSocketError",
    "BrokerCapabilities",
    "BrokerUnsupportedOperationError",
    "assertBrokerContract",
    "brokerCapabilitiesErrMsgs",
    "getBrokerMutationOutcome",
    "normalizeBinanceId",
  ])
})

test("public Binance broker can be constructed without opening network connections", () => {
  const broker = new brokers.BinanceWebSocketBroker({
    apiKey: "contract-test-key",
    apiSecret: "contract-test-secret",
    tradingMode: "testnet",
  })

  for (const method of [
    "connect",
    "disconnect",
    "getAssets",
    "getBalances",
    "getAccountSnapshot",
    "getOpenOrders",
    "getOrder",
    "createOrder",
    "cancelOrder",
    "cancelAllOpenOrders",
    "getPrices",
    "subscribeForPrices",
    "subscribeForUserData",
  ]) {
    assert.equal(typeof broker[method], "function", `expected public method ${method}()`)
  }
})

test("both public broker facades implement the same exchange-neutral method surface", () => {
  const brokersUnderTest = [
    new brokers.BinanceWebSocketBroker({
      apiKey: "contract-test-key",
      apiSecret: "contract-test-secret",
      tradingMode: "testnet",
    }),
    new brokers.BitunixSpotBroker({
      apiKey: "contract-test-key",
      apiSecret: "contract-test-secret",
      tradingMode: "live",
    }),
  ]
  const methods = [
    ...brokers.BROKER_METHODS,
    ...brokers.BROKER_COMPATIBILITY_METHODS,
  ]

  for (const broker of brokersUnderTest) {
    assert.equal(brokers.assertBrokerContract({ broker }), broker)
    for (const method of methods) {
      assert.equal(typeof broker[method], "function", `expected common broker method ${method}()`)
    }
    assert.ok(broker.capabilities instanceof brokers.BrokerCapabilities)
    assert.equal(broker.capabilities.provider, broker instanceof brokers.BinanceWebSocketBroker ? "binance" : "bitunix")
  }
})

test("public Bitunix Spot WebSocket client is independently constructible without connecting", () => {
  const client = new brokers.BitunixSpotWebSocketClient({
    apiKey: "contract-test-key",
    apiSecret: "contract-test-secret",
    transportFactory: () => ({
      connect: async () => {},
      send: () => {},
      close: async () => {},
      onMessage: () => () => {},
      onClose: () => () => {},
      onError: () => () => {},
    }),
  })

  assert.equal(client.state, "idle", "constructing the public RPC client must not open a network connection")
  assert.equal(typeof client.getLastPrice, "function", "public market RPC methods must be exposed")
  assert.equal(typeof client.getAccount, "function", "private read-only RPC methods must be exposed")
  assert.equal(typeof client.placeOrder, "undefined", "the RPC client must not expose order mutation methods")
})
