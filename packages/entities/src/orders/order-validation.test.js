import assert from "node:assert/strict"
import test from "node:test"
import { Order } from "./order.js"
import { errMsgs } from "./err-msgs.js"

const validOrderInput = {
  symbol: "btcusdt",
  type: "LIMIT",
  side: "BUY",
  quantity: 0.1,
  price: 23_456,
  id: "order-id-1",
}
const invalidPrice = () => new Order({
  ...validOrderInput,
  price: 0,
})
const invalidId = () => new Order({
  ...validOrderInput,
  id: " ",
})
const invalidClientOrderId = () => new Order({
  ...validOrderInput,
  clientOrderId: " ",
})

test("Order constructor preserves domain error class and validation messages", () => {
  assert.throws(
    invalidPrice,
    {
      name: "Error",
      message: errMsgs.price,
    },
    "Order price rejection must retain its domain Error and field-specific message",
  )
  assert.throws(
    invalidId,
    {
      name: "Error",
      message: errMsgs.id,
    },
    "Order identity rejection must retain its domain Error and field-specific message",
  )
  assert.throws(
    invalidClientOrderId,
    {
      name: "Error",
      message: errMsgs.clientOrderId,
    },
    "Optional client-order identity rejection must retain its domain Error and field-specific message",
  )
})
