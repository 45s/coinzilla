import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"

test("Bitunix Futures getOrderBook returns exact public bid and ask levels", async () => {
  const requests = []
  const broker = new Broker({
    provider: "bitunix-futures",
    apiKey: "bitunix-futures-order-book-test-key",
    apiSecret: "bitunix-futures-order-book-test-secret",
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        fetchFn: async (...requestArgs) => {
          const [url, options] = requestArgs
          requests.push({
            url,
            options,
          })
          return {
            ok: true,
            status: 200,
            text: async () => '{"code":0,"data":{"asks":[[0.1001,0.123456789012345678],[0.1002,10]],"bids":[[0.1,1],[0.0999,10.23]]}}',
          }
        },
      },
    },
  })

  const result = await broker.getOrderBook({
    symbol: "BTCUSDT",
    limit: "max",
  })

  assert.equal(result.ok, true, "a valid public depth response must return a successful order book")
  assert.deepEqual(result.data, {
    symbol: "BTCUSDT",
    asks: [
      ["0.1001", "0.123456789012345678"],
      ["0.1002", "10"],
    ],
    bids: [
      ["0.1", "1"],
      ["0.0999", "10.23"],
    ],
  }, "depth levels must retain exact decimal strings and exchange order")
  const requestUrl = new URL(requests[0].url)
  assert.equal(requestUrl.pathname, "/api/v1/futures/market/depth", "the order book must use the documented Futures depth endpoint")
  assert.equal(requestUrl.searchParams.get("symbol"), "BTCUSDT", "the order book request must be symbol-scoped")
  assert.equal(requestUrl.searchParams.get("limit"), "max", "the requested depth gear must be preserved")
  assert.equal(requests[0].options.method, "GET", "order book reads must use GET")
  assert.equal(Object.hasOwn(requests[0].options.headers, "api-key"), false, "public depth reads must not include authentication")
})
