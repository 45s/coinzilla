import assert from "node:assert/strict"
import test from "node:test"
import { Order } from "@coinzilla/entities"
import { adaptOrder } from "./adapt-order.js"

test("adapts Bitunix Spot order rows while retaining exact decimal strings", () => {
  const order = adaptOrder({
    orderId: "123456",
    symbol: "BTCUSDT",
    side: "2",
    type: "1",
    status: "3",
    volume: "0.01000000",
    dealVolume: "0.00400000",
    price: "65000.10",
    ctime: "2026-11-15T10:00:00Z",
    utime: "2026-11-15T10:01:00Z",
  })

  assert.ok(order instanceof Order)
  assert.equal(order.id, "123456")
  assert.equal(order.side, "BUY")
  assert.equal(order.type, "LIMIT")
  assert.equal(order.symbol, "BTCUSDT")
  assert.equal(order.originalQuantity, "0.01000000")
  assert.equal(order.executedQuantity, "0.00400000")
  assert.equal(order.originalPrice, "65000.10")
  assert.equal(order.status, "PARTIALLY_FILLED")
})

test("rejects unknown Bitunix Spot side, type, status, and missing identifiers", () => {
  const valid = {
    orderId: "123456",
    symbol: "BTCUSDT",
    side: "2",
    type: "1",
    status: "1",
    volume: "0.01",
    dealVolume: "0",
    price: "65000",
  }

  for (const invalid of [
    { ...valid, orderId: "" },
    { ...valid, side: "3" },
    { ...valid, type: "3" },
    { ...valid, status: "9" },
    { ...valid, volume: "not-a-number" },
  ]) {
    assert.throws(() => adaptOrder(invalid))
  }
})
