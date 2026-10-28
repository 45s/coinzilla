import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildQueryString, getFirstTicket, isEmptyValue, validateRequiredParameters } from "./helpers.js"

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

describe("isEmptyValue", () => {
  it("treats whitespace-only strings as empty", () => {
    for (const value of [" ", "\t", "\n", " \t\n "]) {
      assert.equal(isEmptyValue(value), true)
    }
    assert.equal(isEmptyValue(" BTC "), false)
    assert.equal(isEmptyValue(""), true)
  })
})

describe("validateRequiredParameters", () => {
  it("rejects whitespace-only required values", () => {
    assert.throws(() => validateRequiredParameters({ symbol: " \t " }), {
      name: "MissingParameterError",
    })
  })

  it("preserves valid false and zero values", () => {
    assert.doesNotThrow(() => validateRequiredParameters({ enabled: false, limit: 0 }))
  })
})
