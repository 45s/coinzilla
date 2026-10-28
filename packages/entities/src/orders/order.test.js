import assert from "node:assert"
import { describe, it } from "node:test"
import { generateUUID } from "@coinzilla/utils"
import { Order } from "./order.js"
import { errMsgs } from "./err-msgs.js"

describe(`${Order.name}`, () => {
  const symbol = "btcusdt"
  const quantity = 0.1
  const type = "LIMIT"
  const side = "BUY"
  const price = 23_456
  const id = generateUUID()

  it("should return an order entity", () => {
    const o = new Order({
      symbol,
      type,
      side,
      quantity,
      price,
      id,
    })
    assert(o.symbol, "BTCUSDT")
    assert(o.type, type)
    assert(o.side, side)
    assert(o.quantity, quantity)
    assert(o.price, price)
    assert(o.id, id)
  })

  it("should throw an error with invalid symbol", () => {
    assert.throws(() => new Order({ symbol: "  " }), {
      message: errMsgs.symbol,
    })
  })

  it("should throw an error with invalid type", () => {
    assert.throws(
      () =>
        new Order({
          symbol,
          type: "limit",
        }),
      { message: errMsgs.type },
    )
  })

  it("should throw an error with invalid side", () => {
    assert.throws(
      () =>
        new Order({
          symbol,
          type,
          side: "sell",
        }),
      { message: errMsgs.side },
    )
  })

  it("should throw an error with invalid quantity", () => {
    assert.throws(
      () =>
        new Order({
          symbol,
          type,
          side,
          quantity: "23",
        }),
      { message: errMsgs.quantity },
    )
  })

  it("should reject negative quantity", () => {
    assert.throws(
      () => new Order({ symbol, type, side, quantity: -1, price, id }),
      { message: errMsgs.quantity },
    )
  })

  it("should throw an error with invalid price", () => {
    assert.throws(
      () =>
        new Order({
          symbol,
          type,
          side,
          quantity,
          price: "43",
        }),
      { message: errMsgs.price },
    )
  })

  it("should reject negative price", () => {
    assert.throws(
      () => new Order({ symbol, type, side, quantity, price: -1, id }),
      { message: errMsgs.price },
    )
  })

  it("should throw an error with invalid id", () => {
    assert.throws(
      () =>
        new Order({
          symbol,
          type,
          side,
          quantity,
          price,
          id: "    ",
        }),
      { message: errMsgs.id },
    )
  })
})
