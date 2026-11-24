import assert from "node:assert/strict"
import test from "node:test"

import { adaptFuturesOrderBook } from "./adapt-futures-order-book.js"

test("adaptFuturesOrderBook preserves exact string levels and exchange ordering", () => {
  const orderBook = adaptFuturesOrderBook({
    symbol: "BTCUSDT",
    data: {
      asks: [
        ["0.1001", "0.123456789012345678"],
        ["0.1002", "10"],
      ],
      bids: [
        ["0.1", "1"],
        ["0.0999", "10.23"],
      ],
    },
  })

  assert.equal(orderBook.symbol, "BTCUSDT", "the symbol must be explicit")
  assert.equal(orderBook.asks[0][1], "0.123456789012345678", "quantity precision must remain exact")
  assert.equal(orderBook.bids[0][0], "0.1", "bid price must remain exact")
})

test("adaptFuturesOrderBook rejects unordered or non-positive depth levels", () => {
  assert.throws(
    () => adaptFuturesOrderBook({
      symbol: "BTCUSDT",
      data: {
        asks: [
          ["0.1002", "1"],
          ["0.1001", "1"],
        ],
        bids: [],
      },
    }),
    /asks depth levels are not strictly price-ordered/,
    "ask levels must be strictly ascending",
  )
  assert.throws(
    () => adaptFuturesOrderBook({
      symbol: "BTCUSDT",
      data: {
        asks: [],
        bids: [["0.1", "0"]],
      },
    }),
    /price and quantity must be positive/,
    "zero quantity levels must be rejected",
  )
})
