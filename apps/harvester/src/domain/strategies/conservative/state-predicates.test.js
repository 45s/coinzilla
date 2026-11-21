import nodeTest from "node:test"
import assert from "node:assert/strict"
import {
  hasActiveOrder,
  hasActivePosition,
  hasOutstandingRecovery,
  hasSellableInventory,
  isActiveOrderStatus,
} from "./state-predicates.js"

const test = (...args) => nodeTest(`[state-predicates.test.js] ${args[0]}`, ...args.slice(1))

test("recognizes only order states that block duplicate intents", () => {
  for (const status of ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"]) {
    assert.equal(
      isActiveOrderStatus({ status }),
      true,
      `Order status ${status} must suppress a duplicate intent`,
    )
  }
  for (const status of ["FILLED", "CANCELED", "EXPIRED", "REJECTED", undefined]) {
    assert.equal(
      isActiveOrderStatus({ status }),
      false,
      `Terminal or missing order status ${String(status)} must not suppress a new intent`,
    )
  }
})

test("matches active orders by symbol and side", () => {
  const activeOrders = [
    { market: { symbol: "DOGEUSDT" },
side: "BUY",
status: "OPEN" },
    { market: { symbol: "ZROUSDT" },
side: "SELL",
status: "UNKNOWN" },
    { market: { symbol: "DOGEUSDT" },
side: "SELL",
status: "FILLED" },
  ]

  assert.equal(
    hasActiveOrder({
      activeOrders,
      symbol: "DOGEUSDT",
      side: "BUY",
    }),
    true,
    "An open BUY on the requested market must block another BUY",
  )
  assert.equal(
    hasActiveOrder({
      activeOrders,
      symbol: "DOGEUSDT",
      side: "SELL",
    }),
    false,
    "A terminal SELL must not block another SELL on the same market",
  )
  assert.equal(
    hasActiveOrder({
      activeOrders,
      symbol: "ZROUSDT",
      side: "SELL",
    }),
    true,
    "An unknown SELL on the requested market must remain blocking",
  )
  assert.equal(
    hasActiveOrder({
      activeOrders,
      symbol: "BTCUSDT",
      side: "BUY",
    }),
    false,
    "An active order on another market must not block this market",
  )
})

test("detects an active strategy position only for positive quantity", () => {
  assert.equal(
    hasActivePosition({ activeQuantity: "0.0001" }),
    true,
    "A positive active quantity must represent an active strategy position",
  )
  assert.equal(
    hasActivePosition({ activeQuantity: "0" }),
    false,
    "A zero active quantity must not represent an active strategy position",
  )
})

test("detects only inventory above the exact retained keep quantity as sellable", () => {
  assert.equal(
    hasSellableInventory({
      activeQuantity: "1.01",
      keepQuantity: "1",
    }),
    true,
    "Inventory above the retained keep quantity must be sellable",
  )
  assert.equal(
    hasSellableInventory({
      activeQuantity: "1",
      keepQuantity: "1",
    }),
    false,
    "Inventory equal to the retained keep quantity must remain unsold",
  )
  assert.equal(
    hasSellableInventory({
      activeQuantity: "0.99",
      keepQuantity: "1",
    }),
    false,
    "Inventory below the retained keep quantity must not be sellable",
  )
})

test("keeps the full recovery basis outstanding until cumulative net proceeds cover it", () => {
  assert.equal(
    hasOutstandingRecovery({
      positionSpent: "10",
      netSellProceeds: "9.99",
    }),
    true,
    "Recovery remains outstanding while net SELL proceeds are below the BUY cost basis",
  )
  assert.equal(
    hasOutstandingRecovery({
      positionSpent: "10",
      netSellProceeds: "10",
    }),
    false,
    "Recovery is complete when net SELL proceeds exactly cover the BUY cost basis",
  )
  assert.equal(
    hasOutstandingRecovery({
      positionSpent: "10",
      netSellProceeds: "10.01",
    }),
    false,
    "Recovery is complete when net SELL proceeds exceed the BUY cost basis",
  )
  assert.equal(
    hasOutstandingRecovery({
      positionSpent: "0",
      netSellProceeds: "0",
    }),
    false,
    "A zero BUY cost basis must not leave recovery outstanding",
  )
})
