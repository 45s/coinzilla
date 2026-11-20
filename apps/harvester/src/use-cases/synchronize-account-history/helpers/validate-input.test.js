import assert from "node:assert/strict"
import test from "node:test"
import {
  requireNumericCursor,
  validatePage,
} from "./validate-input.js"

test("accepts only safe non-negative integer exchange cursors", () => {
  assert.equal(
    requireNumericCursor({
      value: "123",
      field: "order ID",
      symbol: "BTCUSDT",
    }),
    123,
    "A valid decimal exchange cursor must be converted to its numeric pagination value.",
  )
  assert.throws(
    () => requireNumericCursor({
      value: "9007199254740992",
      field: "order ID",
      symbol: "BTCUSDT",
    }),
    /safe pagination range/,
    "An exchange cursor outside JavaScript's safe integer range must be rejected.",
  )
})

test("rejects malformed and oversized exchange history pages", () => {
  assert.throws(
    () => validatePage({
      result: {
        ok: false,
        data: [],
      },
      symbol: "BTCUSDT",
      limit: 10,
      historyType: "order",
    }),
    /Unable to fetch Binance order history/,
    "A failed broker response must not be treated as an empty history page.",
  )
  assert.throws(
    () => validatePage({
      result: {
        ok: true,
        data: [{}, {}],
      },
      symbol: "BTCUSDT",
      limit: 1,
      historyType: "trade",
    }),
    /exceeded the requested page size/,
    "A broker page larger than the requested limit must be rejected.",
  )
})
