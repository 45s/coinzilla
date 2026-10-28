import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { getPrices } from "./get-prices.js"

describe("Binance getPrices response", () => {
  it("converts returned prices to numbers", async () => {
    const originalFetch = globalThis.fetch
    let requestedUrl

    globalThis.fetch = async (url) => {
      requestedUrl = String(url)
      return {
        headers: { get: () => "application/json" },
        json: async () => [{ symbol: "BTCUSDT", price: "65000.1200" }],
        text: async () => "",
      }
    }

    try {
      assert.deepEqual(await getPrices({ tickets: ["BTCUSDT"] }), [
        { symbol: "BTCUSDT", price: 65000.12 },
      ])
      assert.match(requestedUrl, /ticker\/price\?symbols=%5B%22BTCUSDT%22%5D$/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})