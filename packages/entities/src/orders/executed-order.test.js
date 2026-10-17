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

  it(`should be instanceof ${Order.name}`, () => {
    const o = new ExecutedOrder({
      symbol,
      type,
      side,
      quantity,
      price,
      id,
    })
    assert(o instanceof Order)
    assert(o.symbol, "BTCUSDT")
    assert(o.type, type)
    assert(o.side, side)
    assert(o.quantity, quantity)
    assert(o.price, price)
    assert(o.id, id)
  })
})
