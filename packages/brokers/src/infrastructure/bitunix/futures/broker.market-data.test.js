import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"

const credentials = {
  apiKey: "bitunix-futures-market-data-test-key",
  apiSecret: "bitunix-futures-market-data-test-secret",
}

function createFuturesResponse({ data }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      code: 0,
      data,
    }),
  }
}

test("Bitunix Futures getPrices maps the last traded price and mark price from the public ticker", async () => {
  const requests = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        fetchFn: async (...requestArgs) => {
          const [url, options] = requestArgs
          requests.push({
            url,
            options,
          })
          return createFuturesResponse({
            data: [{
              symbol: "BTCUSDT",
              markPrice: "100.20",
              lastPrice: "100.25",
              open: "99.00",
              last: "100.25",
              quoteVol: "1000",
              baseVol: "10",
              high: "101.00",
              low: "98.00",
            }],
          })
        },
      },
    },
  })

  const result = await broker.getPrices({
    symbol: "BTCUSDT",
  })

  assert.equal(result.ok, true, "a valid public Futures ticker must return a successful price result")
  assert.deepEqual(result.data, {
    symbol: "BTCUSDT",
    price: "100.25",
    markPrice: "100.20",
  }, "the common one-shot price result must preserve exact last and mark price strings")
  assert.equal(requests.length, 1, "one symbol ticker request must be dispatched exactly once")
  assert.equal(requests[0].url, "https://fapi.bitunix.com/api/v1/futures/market/tickers?symbols=BTCUSDT", "the ticker request must use the documented Futures endpoint and symbols query")
  assert.equal(requests[0].options.method, "GET", "ticker reads must use GET")
  assert.equal(Object.hasOwn(requests[0].options.headers, "api-key"), false, "public ticker reads must not include authentication")
})
