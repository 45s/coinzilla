import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildQueryString } from "./helpers.js"

describe("buildQueryString", () => {
  it("encodes arrays in the format expected by Binance", () => {
    assert.equal(
      buildQueryString({ symbols: ["BTCUSDT", "BNBBTC"] }),
      "symbols=%5B%22BTCUSDT%22%2C%22BNBBTC%22%5D",
    )
  })

  it("escapes quotes and backslashes inside array values", () => {
    const value = ['BTC"USDT', "BNB\\BTC"]
    const query = buildQueryString({ symbols: value })
    const encodedValue = query.slice("symbols=".length)

    assert.deepEqual(JSON.parse(decodeURIComponent(encodedValue)), value)
  })
})
