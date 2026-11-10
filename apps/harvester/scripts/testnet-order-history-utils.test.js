import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizeOrderHistory,
  parseOrderHistoryArguments,
} from "./testnet-order-history-utils.js"

const createOrder = (overrides = {}) => ({
  symbol: "ZROUSDT",
  orderId: 100,
  clientOrderId: "client-100",
  side: "BUY",
  type: "LIMIT",
  status: "FILLED",
  price: "1.25000000",
  origQty: "10.00000000",
  executedQty: "10.00000000",
  cummulativeQuoteQty: "12.50000000",
  time: 1_700_000_000_000,
  ...overrides,
})

test("parseOrderHistoryArguments uses the ZROUSDT and 20-order defaults", () => {
  assert.deepEqual(parseOrderHistoryArguments({}), {
    symbol: "ZROUSDT",
    limit: 20,
  })
})

test("parseOrderHistoryArguments normalizes symbol and accepts a custom limit", () => {
  assert.deepEqual(parseOrderHistoryArguments({ args: ["btcusdt", "50"] }), {
    symbol: "BTCUSDT",
    limit: 50,
  })
})

test("parseOrderHistoryArguments rejects invalid symbols, limits, and extra arguments", () => {
  assert.throws(() => parseOrderHistoryArguments({ args: ["bad!"] }), /Symbol/)
  assert.throws(() => parseOrderHistoryArguments({ args: ["ZROUSDT", "0"] }), /Limit/)
  assert.throws(() => parseOrderHistoryArguments({ args: ["ZROUSDT", "1001"] }), /Limit/)
  assert.throws(() => parseOrderHistoryArguments({ args: ["ZROUSDT", "2", "extra"] }), /Usage/)
})

test("normalizeOrderHistory returns newest orders first and preserves exact exchange values", () => {
  const { orders } = normalizeOrderHistory({
    orders: [
      createOrder({ orderId: 101, time: 1_700_000_000_100, status: "CANCELED" }),
      createOrder({ orderId: 99, time: 1_700_000_000_000 }),
      createOrder({ orderId: 102, time: 1_700_000_000_100, status: "PARTIALLY_FILLED" }),
    ],
    limit: 2,
  })

  assert.deepEqual(orders.map(({ orderId }) => orderId), ["102", "101"])
  assert.equal(orders[0].status, "PARTIALLY_FILLED")
  assert.equal(orders[0].quantity, "10.00000000")
  assert.equal(orders[0].quote, "12.50000000")
  assert.equal(orders[0].clientOrderId, "client-100")
})

test("normalizeOrderHistory supports exact numeric or string Binance order IDs", () => {
  const { orders } = normalizeOrderHistory({
    orders: [createOrder({ orderId: "9007199254740991" })],
  })

  assert.equal(orders[0].orderId, "9007199254740991")
})

test("normalizeOrderHistory rejects malformed responses and invalid limits", () => {
  assert.throws(() => normalizeOrderHistory({ orders: null }), /must be an array/)
  assert.throws(() => normalizeOrderHistory({ orders: [], limit: 1001 }), /limit/)
  assert.throws(
    () => normalizeOrderHistory({ orders: [createOrder({ orderId: Number.MAX_SAFE_INTEGER + 1 })] }),
    /invalid orderId/,
  )
  assert.throws(
    () => normalizeOrderHistory({ orders: [createOrder({ time: "not-a-time" })] }),
    /invalid time/,
  )
  assert.throws(
    () => normalizeOrderHistory({ orders: [createOrder({ executedQty: 10 })] }),
    /invalid executedQty/,
  )
})
