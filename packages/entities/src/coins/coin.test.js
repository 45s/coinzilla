import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { errMsgs, Coin } from "./coin.js"

describe(`${Coin.name}`, () => {
  const ticker = "btc"
  const quantity = 3

  const createCoin = (overrides = {}) =>
    new Coin({ ticker, quantity, ...overrides })

  it("normalizes the ticker and exposes the complete value", () => {
    const coin = createCoin({ ticker: "  btc  " })

    assert.equal(coin.ticker, "BTC")
    assert.equal(coin.quantity, quantity)
    assert.deepEqual(coin.value, { ticker: "BTC", quantity })
  })

  it("accepts zero quantity", () => {
    const coin = createCoin({ quantity: 0 })

    assert.equal(coin.quantity, 0)
    assert.deepEqual(coin.value, { ticker: "BTC", quantity: 0 })
  })

  it("rejects missing, non-string, and blank tickers", () => {
    for (const invalidTicker of [undefined, null, "", "   ", 123]) {
      assert.throws(
        () => createCoin({ ticker: invalidTicker }),
        { message: errMsgs.ticker },
      )
    }
  })

  it("rejects missing, non-numeric, non-finite, and negative quantities", () => {
    for (const invalidQuantity of [
      undefined,
      null,
      "3",
      NaN,
      Infinity,
      -Infinity,
      -1,
    ]) {
      assert.throws(
        () => createCoin({ quantity: invalidQuantity }),
        { message: errMsgs.quantity },
      )
    }
  })

  it("requires constructor input to be an object", () => {
    for (const input of [undefined]) {
      assert.throws(() => new Coin(input), {
        message: errMsgs.ticker,
      })
    }
  })
})

  it("returns a fresh value snapshot on each access", () => {
    const coin = createCoin()
    const snapshot = coin.value
    snapshot.ticker = "ETH"
    snapshot.quantity = 99
    assert.deepEqual(coin.value, { ticker: "BTC", quantity })
    assert.notStrictEqual(coin.value, snapshot)
  })
