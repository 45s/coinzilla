import assert from "node:assert/strict"
import test from "node:test"

import * as brokers from "./index.js"

test("package entry point exposes only the supported public contracts", () => {
  assert.deepEqual(Object.keys(brokers).sort(), [
    "BinanceWebSocketBroker",
    "BinanceWebSocketConfig",
    "BitunixSpotBroker",
    "BitunixSpotConfig",
    "BitunixSpotWebSocketClient",
    "BitunixWebSocketError",
    "CoreBroker",
    "normalizeBinanceId",
  ])
})

test("public Binance broker can be constructed without opening network connections", () => {
  const broker = new brokers.BinanceWebSocketBroker({
    apiKey: "contract-test-key",
    apiSecret: "contract-test-secret",
    tradingMode: "testnet",
  })

  assert.ok(broker instanceof brokers.CoreBroker)
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
