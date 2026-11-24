import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"
import { Market } from "@coinzilla/entities"

const credentials = {
  apiKey: "bitunix-futures-market-test-key",
  apiSecret: "bitunix-futures-market-test-secret",
}

test("Bitunix Futures market catalog returns only open API-tradable USDT markets", async () => {
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
  })
  const requests = []
  broker.restClient = {
    request: async (request) => {
      requests.push(request)
      return {
        data: [
          {
            symbol: "BTCUSDT",
            base: "BTC",
            quote: "USDT",
            symbolStatus: "OPEN",
            isApiSupported: true,
          },
          {
            symbol: "ETHUSDT",
            base: "ETH",
            quote: "USDT",
            symbolStatus: "CANCEL_ONLY",
            isApiSupported: true,
          },
          {
            symbol: "XRPUSDT",
            base: "XRP",
            quote: "USDT",
            symbolStatus: "OPEN",
            isApiSupported: false,
          },
        ],
      }
    },
  }

  const result = await broker.getExchangeMarkets()

  assert.equal(result.ok, true, "a valid Futures market catalog response must produce a successful Broker result")
  assert.equal(requests.length, 1, "market discovery must use exactly one catalog request")
  assert.deepEqual(requests[0], {
    method: "GET",
    path: "/api/v1/futures/market/trading_pairs",
    authenticated: false,
  }, "public Futures market discovery must use the documented unauthenticated endpoint")
  assert.equal(result.data.length, 1, "closed-only and API-disabled contracts must not be advertised as tradable")
  assert.ok(result.data[0] instanceof Market, "Futures markets must use the shared canonical Market entity")
  assert.equal(result.data[0].id, "bitunix:BTCUSDT", "the canonical market identity must preserve the Bitunix symbol")
  assert.equal(result.data[0].baseAsset.code, "BTC", "the base asset must be mapped from the documented pair metadata")
  assert.equal(result.data[0].quoteAsset.code, "USDT", "the quote asset must be mapped from the documented pair metadata")
})
