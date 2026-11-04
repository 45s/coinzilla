import assert from "node:assert/strict"
import test from "node:test"

import { CanonicalOrder, Market } from "@coinzilla/entities"
import {
  adaptCanonicalOrderHistory,
  createCanonicalOrderHistoryMarket,
  requireOrderHistoryArray,
  validateOrderHistoryCursorItems,
} from "./order-history.js"

const order = {
  symbol: "DOGEFDUSD",
  orderId: 123,
  clientOrderId: "client-123",
  side: "BUY",
  type: "LIMIT",
  status: "PARTIALLY_FILLED",
  price: "0.05000000",
  origQty: "100.00000000",
  executedQty: "25.50000000",
  time: 1_700_000_000_000,
  updateTime: 1_700_000_000_100,
}

const exchangeInfo = {
  symbols: [{ symbol: "DOGEFDUSD", baseAsset: "DOGE", quoteAsset: "FDUSD" }],
}

test("requires an array for Binance allOrders responses", () => {
  const orders = [order]
  assert.strictEqual(requireOrderHistoryArray({ orders }), orders)
  assert.deepEqual(requireOrderHistoryArray({ orders: [] }), [])
  for (const invalid of [undefined, null, {}, "not-an-array"]) {
    assert.throws(() => requireOrderHistoryArray({ orders: invalid }), /allOrders response should be an array/)
  }
})

test("validates cursor order objects and normalizable order IDs without mutating them", () => {
  const orders = [order, { ...order, orderId: "456" }]
  assert.strictEqual(validateOrderHistoryCursorItems({ orders }), orders)
  assert.equal(orders[0].orderId, 123)
  assert.equal(orders[1].orderId, "456")

  for (const invalid of [
    [null],
    [[]],
    [{ ...order, orderId: null }],
    [{ ...order, orderId: "" }],
    [{ ...order, orderId: "not-numeric" }],
  ]) {
    assert.throws(() => validateOrderHistoryCursorItems({ orders: invalid }))
  }
})

test("creates a canonical order market from one exact symbol match", () => {
  const market = createCanonicalOrderHistoryMarket({
    symbol: "DOGEFDUSD",
    exchangeInfo,
  })

  assert.ok(market instanceof Market)
  assert.equal(market.id, "binance:DOGEFDUSD")
  assert.equal(market.baseAsset.code, "DOGE")
  assert.equal(market.quoteAsset.code, "FDUSD")
})

test("rejects missing or ambiguous exchange metadata for canonical history", () => {
  for (const invalid of [
    { symbols: [] },
    { symbols: [exchangeInfo.symbols[0], exchangeInfo.symbols[0]] },
    {},
  ]) {
    assert.throws(() => createCanonicalOrderHistoryMarket({
      symbol: "DOGEFDUSD",
      exchangeInfo: invalid,
    }), /market metadata is missing or ambiguous/)
  }
})

test("adapts canonical order history using the supplied market identity", () => {
  const market = createCanonicalOrderHistoryMarket({
    symbol: "DOGEFDUSD",
    exchangeInfo,
  })
  const orders = adaptCanonicalOrderHistory({ orders: [order], market })

  assert.equal(orders.length, 1)
  assert.ok(orders[0] instanceof CanonicalOrder)
  assert.equal(orders[0].brokerOrderId, "123")
  assert.equal(orders[0].clientOrderId, "client-123")
  assert.equal(orders[0].status, "PARTIALLY_FILLED")
  assert.strictEqual(orders[0].market, market)
  assert.equal(orders[0].originalQuantity.amount, "100")
  assert.equal(orders[0].executedQuantity.amount, "25.5")
})
