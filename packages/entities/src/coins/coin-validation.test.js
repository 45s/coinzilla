import assert from "node:assert/strict"
import test from "node:test"
import { Coin, errMsgs } from "./coin.js"

const invalidTicker = () => new Coin({
  ticker: " ",
  quantity: 0,
})
const invalidQuantity = () => new Coin({
  ticker: "BTC",
  quantity: -1,
})

test("Coin constructor preserves domain error class and validation messages", () => {
  assert.throws(
    invalidTicker,
    {
      name: "Error",
      message: errMsgs.ticker,
    },
    "Coin ticker rejection must retain its domain Error and field-specific message",
  )
  assert.throws(
    invalidQuantity,
    {
      name: "Error",
      message: errMsgs.quantity,
    },
    "Coin quantity rejection must retain its domain Error and field-specific message",
  )
})
