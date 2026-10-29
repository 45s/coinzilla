import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildQueryString, getFirstTicket, validateRequiredParameters } from "./helpers.js"

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

  it("preserves false and zero query values", () => {
    assert.equal(buildQueryString({ enabled: false, limit: 0 }), "enabled=false&limit=0")
  })

  it("returns an empty string for absent parameters", () => {
    assert.equal(buildQueryString(undefined), "")
    assert.equal(buildQueryString(null), "")
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

it("percent-encodes reserved characters in scalar values", () => {
  assert.equal(buildQueryString({ symbol: "BTC/USDT + test" }), "symbol=BTC%2FUSDT%20%2B%20test")
})
