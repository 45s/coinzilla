import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildQueryString, getFirstTicket } from "./helpers.js"

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


describe("getFirstTicket", () => {
  it("returns the first symbol from a non-empty ticket array", () => {
    assert.equal(getFirstTicket(["BTCUSDT", "ETHUSDT"]), "BTCUSDT")
  })

  it("rejects missing, non-array, and empty ticket lists", () => {
    for (const tickets of [undefined, null, "BTCUSDT", [], {}, [42], ["   "]]) {
      assert.throws(() => getFirstTicket(tickets), {
        name: "MissingParameterError",
      })
    }
  })

  it("rejects an empty first ticket", () => {
    assert.throws(() => getFirstTicket([""]), {
      name: "MissingParameterError",
    })
  })
})
