import assert from "node:assert/strict"
import test from "node:test"

import * as brokers from "./index.js"

test("package entry point exposes only the supported public contracts", () => {
  assert.deepEqual(Object.keys(brokers).sort(), [
    "BinanceWebSocketBroker",
    "BinanceWebSocketConfig",
    "CoreBroker",
    "normalizeBinanceId",
  ])
})

test("public Binance broker can be constructed without opening network connections", () => {
  const broker = new brokers.BinanceWebSocketBroker({
    apiKey: "contract-test-key",
    apiSecret: "contract-test-secret",
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
