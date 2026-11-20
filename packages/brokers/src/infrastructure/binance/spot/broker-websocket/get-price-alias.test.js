import assert from "node:assert/strict"
import test from "node:test"

import { BinanceWebSocketBroker } from "./broker.js"

test("Binance getPrice remains a compatibility alias for getPrices", async () => {
  const requests = []
  const broker = new BinanceWebSocketBroker({
    apiKey: "key",
    apiSecret: "secret",
    tradingMode: "testnet",
  }, {
    apiClientFactory: () => ({
      state: "open",
      async request(...args) {
        const [method, params] = args
        requests.push({
          method,
          params,
        })
        return {
          data: {
            symbol: params.symbol,
            price: "123.45000000",
          },
        }
      },
      async connect() {},
      async disconnect() {},
    }),
    marketClientFactory: () => ({
      async disconnect() {},
      async subscribe() {},
      async unsubscribe() {},
    }),
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
  })

  const result = await broker.getPrice({ symbol: "BTCUSDT" })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, {
    symbol: "BTCUSDT",
    price: "123.45000000",
  })
  assert.deepEqual(requests, [{
    method: "ticker.price",
    params: { symbol: "BTCUSDT" },
  }])
})
