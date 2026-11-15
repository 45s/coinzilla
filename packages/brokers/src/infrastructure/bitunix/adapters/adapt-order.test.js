import assert from "node:assert/strict"
import test from "node:test"
import { adaptOrder } from "./adapt-order.js"

const validOrder = {
  orderId: "123",
  symbol: "BTCUSDT",
  side: "2",
  type: "1",
  status: "3",
  volume: "0.300000000000000001",
  dealVolume: "0.1",
  price: "10.25",
}

test("adaptOrder preserves exact original, executed and remaining quantities", () => {
  const order = adaptOrder(validOrder)

  assert.equal(order.originalQuantity, "0.300000000000000001")
  assert.equal(order.executedQuantity, "0.1")
  assert.equal(order.remainingQuantity, "0.200000000000000001")
})

test("adaptOrder rejects negative and overfilled quantities", () => {
  assert.throws(() => adaptOrder({ ...validOrder,
    volume: "-1" }), /non-negative|range|decimal/i)
  assert.throws(() => adaptOrder({ ...validOrder,
    dealVolume: "0.4" }), /range/i)
})

test("adaptOrder maps Bitunix side, type and status", () => {
  const order = adaptOrder(validOrder)

  assert.equal(order.side, "BUY")
  assert.equal(order.type, "LIMIT")
  assert.equal(order.status, "PARTIALLY_FILLED")
})
