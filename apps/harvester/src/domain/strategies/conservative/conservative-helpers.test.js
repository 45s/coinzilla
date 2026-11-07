import test from "node:test"
import assert from "node:assert/strict"
import {
  hasActiveOrder,
  hasActivePosition,
  hasOutstandingRecovery,
  hasSellableInventory,
  isActiveOrderStatus,
} from "./conservative-helpers.js"

test("recognizes only order states that block duplicate intents", () => {
  for (const status of ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"]) {
    assert.equal(isActiveOrderStatus({ status }), true, status)
  }
  for (const status of ["FILLED", "CANCELED", "EXPIRED", "REJECTED", undefined]) {
    assert.equal(isActiveOrderStatus({ status }), false, String(status))
  }
})

test("matches active orders by symbol and side", () => {
  const activeOrders = [
    { market: { symbol: "DOGEUSDT" }, side: "BUY", status: "OPEN" },
    { market: { symbol: "ZROUSDT" }, side: "SELL", status: "UNKNOWN" },
    { market: { symbol: "DOGEUSDT" }, side: "SELL", status: "FILLED" },
  ]

  assert.equal(hasActiveOrder({ activeOrders, symbol: "DOGEUSDT", side: "BUY" }), true)
  assert.equal(hasActiveOrder({ activeOrders, symbol: "DOGEUSDT", side: "SELL" }), false)
  assert.equal(hasActiveOrder({ activeOrders, symbol: "ZROUSDT", side: "SELL" }), true)
  assert.equal(hasActiveOrder({ activeOrders, symbol: "BTCUSDT", side: "BUY" }), false)
})

test("detects active strategy position without counting zero quantity", () => {
  assert.equal(hasActivePosition({ activeQuantity: "0.0001" }), true)
  assert.equal(hasActivePosition({ activeQuantity: "0" }), false)
})

test("detects only inventory above exact keepQuantity as sellable", () => {
  assert.equal(hasSellableInventory({ activeQuantity: "1.01", keepQuantity: "1" }), true)
  assert.equal(hasSellableInventory({ activeQuantity: "1", keepQuantity: "1" }), false)
  assert.equal(hasSellableInventory({ activeQuantity: "0.99", keepQuantity: "1" }), false)
})

test("keeps the full recovery basis outstanding until cumulative proceeds cover it", () => {
  assert.equal(hasOutstandingRecovery({ positionSpent: "10", netSellProceeds: "9.99" }), true)
  assert.equal(hasOutstandingRecovery({ positionSpent: "10", netSellProceeds: "10" }), false)
  assert.equal(hasOutstandingRecovery({ positionSpent: "10", netSellProceeds: "10.01" }), false)
  assert.equal(hasOutstandingRecovery({ positionSpent: "0", netSellProceeds: "0" }), false)
})
