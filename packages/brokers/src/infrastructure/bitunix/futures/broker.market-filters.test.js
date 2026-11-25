import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"

test("Bitunix Futures getSymbolFilters preserves raw contract constraints without inventing tick or step sizes", async () => {
  const requests = []
  const broker = new Broker({
    provider: "bitunix-futures",
    apiKey: "bitunix-futures-filter-test-key",
    apiSecret: "bitunix-futures-filter-test-secret",
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
            json: async () => ({
              code: 0,
              data: [{
                symbol: "BTCUSDT",
                base: "BTC",
                quote: "USDT",
                basePrecision: 3,
                quotePrecision: 2,
                minTradeVolume: "0.001",
                maxLimitOrderVolume: "100",
                maxMarketOrderVolume: "50",
                minBuyPriceOffset: "0.01",
                maxSellPriceOffset: "0.02",
                symbolStatus: "CANCEL_ONLY",
                isApiSupported: true,
              }],
            }),
          }
        },
      },
    },
  })

  const result = await broker.getSymbolFilters({
    symbol: "BTCUSDT",
  })

  assert.equal(result.ok, true, "a valid Futures contract metadata row must be returned")
  assert.equal(result.data.symbol, "BTCUSDT", "the returned metadata must match the requested contract")
  assert.equal(result.data.minTradeVolume, "0.001", "the base-asset minimum volume must be preserved")
  assert.equal(result.data.basePrecision, 3, "base decimal precision must remain raw exchange metadata")
  assert.equal(result.data.quotePrecision, 2, "quote decimal precision must remain raw exchange metadata")
  assert.equal(Object.hasOwn(result.data, "tickSize"), false, "decimal precision must not be fabricated into a price tick")
  assert.equal(Object.hasOwn(result.data, "stepSize"), false, "decimal precision must not be fabricated into a quantity step")
  const requestUrl = new URL(requests[0].url)
  assert.equal(requestUrl.pathname, "/api/v1/futures/market/trading_pairs", "market filters must use the documented trading-pairs endpoint")
  assert.equal(requestUrl.searchParams.get("symbols"), "BTCUSDT", "the query must be scoped to the requested symbol")
  assert.equal(requests[0].options.method, "GET", "market metadata reads must use GET")
})
