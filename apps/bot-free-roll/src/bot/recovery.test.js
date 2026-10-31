import assert from "node:assert/strict"
import test from "node:test"
import { reconcileTrackedOrder, validateRecoveryBalances } from "./recovery.js"

test("validates an exact canonical balance snapshot", () => {
  const result = validateRecoveryBalances({
    balances: [{
      asset: { code: "USDT" },
      free: { amount: "10.25" },
      locked: { amount: "1.75" },
      total: { amount: "12" },
    }],
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.balances.get("USDT"), {
    free: "10.25",
    locked: "1.75",
    total: "12",
  })
})

test("rejects incomplete, duplicate, negative, and inconsistent balance snapshots", () => {
  assert.equal(validateRecoveryBalances({ balances: null }).ok, false)
  assert.equal(validateRecoveryBalances({ balances: [{ asset: { code: "USDT" } }] }).ok, false)
  assert.equal(validateRecoveryBalances({ balances: [
    { asset: { code: "USDT" }, free: { amount: "1" }, locked: { amount: "0" }, total: { amount: "1" } },
    { asset: { code: "USDT" }, free: { amount: "1" }, locked: { amount: "0" }, total: { amount: "1" } },
  ] }).ok, false)
  assert.equal(validateRecoveryBalances({ balances: [
    { asset: { code: "USDT" }, free: { amount: "-1" }, locked: { amount: "0" }, total: { amount: "-1" } },
  ] }).ok, false)
  assert.equal(validateRecoveryBalances({ balances: [
    { asset: { code: "USDT" }, free: { amount: "1" }, locked: { amount: "0" }, total: { amount: "2" } },
  ] }).ok, false)
})

const trackedOrder = {
  id: "order-1",
  side: "BUY",
  quantity: "2",
  price: "10",
}

const fills = [
  { id: "trade-1", orderId: "order-1", symbol: "BTCUSDT", side: "BUY", quantity: "0.5" },
  { id: "trade-2", orderId: "order-1", symbol: "BTCUSDT", side: "BUY", quantity: "1.5" },
]

test("accepts a tracked order present in open orders when exact history matches executed quantity", () => {
  const result = reconcileTrackedOrder({
    symbol: "BTCUSDT",
    order: { ...trackedOrder, quantity: "3" },
    openOrders: [{
      id: "order-1",
      side: "BUY",
      originalQuantity: "3",
      executedQuantity: "2",
      status: "PARTIALLY_FILLED",
    }],
    fills,
  })

  assert.equal(result.ok, true)
  assert.equal(result.status, "OPEN")
  assert.equal(result.historyQuantity, "2")
})

test("infers FILLED only when a missing open order has complete fills equal to its original quantity", () => {
  const result = reconcileTrackedOrder({
    symbol: "BTCUSDT",
    order: trackedOrder,
    openOrders: [],
    fills,
  })

  assert.equal(result.ok, true)
  assert.equal(result.status, "FILLED")
})

test("fails closed for missing orders with partial or empty history", () => {
  for (const history of [[], fills.slice(0, 1)]) {
    const result = reconcileTrackedOrder({
      symbol: "BTCUSDT",
      order: trackedOrder,
      openOrders: [],
      fills: history,
    })
    assert.equal(result.ok, false)
  }
})

test("fails closed for unexpected, mismatched, and potentially truncated order history", () => {
  assert.equal(reconcileTrackedOrder({
    symbol: "BTCUSDT",
    order: trackedOrder,
    openOrders: [{ id: "other", side: "BUY", originalQuantity: "2", executedQuantity: "2", status: "NEW" }],
    fills,
  }).ok, false)

  assert.equal(reconcileTrackedOrder({
    symbol: "BTCUSDT",
    order: trackedOrder,
    openOrders: [],
    fills: [{ ...fills[0], side: "SELL" }],
  }).ok, false)

  assert.equal(reconcileTrackedOrder({
    symbol: "BTCUSDT",
    order: trackedOrder,
    openOrders: [],
    fills: Array.from({ length: 1000 }, (_, index) => ({
      id: `trade-${index}`, orderId: "order-1", symbol: "BTCUSDT", side: "BUY", quantity: "0.002",
    })),
  }).ok, false)
})
