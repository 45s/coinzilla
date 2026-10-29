import assert from "node:assert"
import { describe, it } from "node:test"
import { generateUUID } from "@coinzilla/utils"
import { ExecutedOrder } from "./executed-order.js"
import { Order } from "./order.js"

describe(`${ExecutedOrder.name}`, () => {
  const symbol = "btcusdt"
  const quantity = 0.1
  const type = "LIMIT"
  const side = "BUY"
  const price = 23_456
  const id = generateUUID()

  it(`should be an instance of ${Order.name}`, () => {
    const order = new ExecutedOrder({ symbol, type, side, quantity, price, id })

    assert.ok(order instanceof Order)
    assert.strictEqual(order.symbol, "BTCUSDT")
    assert.strictEqual(order.type, type)
    assert.strictEqual(order.side, side)
    assert.strictEqual(order.quantity, quantity)
    assert.strictEqual(order.price, price)
    assert.strictEqual(order.id, id)
  })

  it("should include execution metadata in its value", () => {
    const execution = {
      status: "FILLED",
      commission: 0.001,
      commissionAsset: "BNB",
    }
    const order = new ExecutedOrder({
      symbol,
      type,
      side,
      quantity,
      price,
      id,
      ...execution,
    })

    assert.deepStrictEqual(order.value, {
      id,
      symbol: "BTCUSDT",
      type,
      side,
      quantity,
      price,
      ...execution,
    })
  })

  it("should preserve explicitly supplied execution metadata values", () => {
    const order = new ExecutedOrder({
      symbol,
      type,
      side,
      quantity,
      price,
      id,
      status: "PARTIALLY_FILLED",
      commission: 0,
      commissionAsset: "",
    })

    assert.strictEqual(order.value.status, "PARTIALLY_FILLED")
    assert.strictEqual(order.value.commission, 0)
    assert.strictEqual(order.value.commissionAsset, "")
  })

  it("should enforce the inherited Order validation", () => {
    assert.throws(
      () => new ExecutedOrder({ symbol, type, side, quantity: NaN, price, id }),
      { message: "Order.quantity should be a number" },
    )
  })
})

  it("preserves explicitly supplied null execution metadata", () => {
    const order = new ExecutedOrder({
      symbol, type, side, quantity, price, id,
      status: null, commission: null, commissionAsset: null,
    })
    assert.equal(order.value.status, null)
    assert.equal(order.value.commission, null)
    assert.equal(order.value.commissionAsset, null)
  })
