import assert from "node:assert/strict"
import test from "node:test"
import { Coin, errMsgs } from "./coin.js"

const invalidTickerInputs = [
  { ticker: undefined, description: "missing ticker" },
  { ticker: null, description: "null ticker" },
  { ticker: 42, description: "numeric ticker" },
  { ticker: "", description: "empty ticker" },
  { ticker: "   ", description: "whitespace-only ticker" },
]
const invalidQuantityInputs = [
  { quantity: undefined, description: "missing quantity" },
  { quantity: "0", description: "string quantity" },
  { quantity: NaN, description: "NaN quantity" },
  { quantity: Infinity, description: "infinite quantity" },
  { quantity: -1, description: "negative quantity" },
]

test("Coin constructor rejects invalid ticker inputs with its domain Error", () => {
  for (const { ticker, description } of invalidTickerInputs) {
    assert.throws(
      () => new Coin({ ticker, quantity: 0 }),
      {
        name: "Error",
        message: errMsgs.ticker,
      },
      `Coin must reject ${description} with its stable ticker error`,
    )
  }
})

test("Coin constructor rejects invalid quantities with its domain Error", () => {
  for (const { quantity, description } of invalidQuantityInputs) {
    assert.throws(
      () => new Coin({ ticker: "BTC", quantity }),
      {
        name: "Error",
        message: errMsgs.quantity,
      },
      `Coin must reject ${description} with its stable quantity error`,
    )
  }
})

test("Coin constructor accepts zero and finite quantities and normalizes ticker", () => {
  const zeroQuantityCoin = new Coin({ ticker: " btc ", quantity: 0 })
  const fractionalQuantityCoin = new Coin({ ticker: "Eth", quantity: 0.25 })

  assert.deepEqual(
    zeroQuantityCoin.value,
    { ticker: "Btc", quantity: 0 },
    "Coin must preserve the valid zero quantity and normalize whitespace/casing in ticker",
  )
  assert.deepEqual(
    fractionalQuantityCoin.value,
    { ticker: "Eth", quantity: 0.25 },
    "Coin must accept a finite fractional quantity without changing its value",
  )
})
