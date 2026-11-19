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
const invalidPriceInputs = [
  { price: undefined, description: "missing price" },
  { price: "1", description: "string price" },
  { price: NaN, description: "NaN price" },
  { price: Infinity, description: "infinite price" },
  { price: 0, description: "zero price" },
  { price: -1, description: "negative price" },
]
const invalidRequiredIdInputs = [
  { id: undefined, description: "missing order ID" },
  { id: null, description: "null order ID" },
  { id: 42, description: "numeric order ID" },
  { id: "", description: "empty order ID" },
  { id: "   ", description: "whitespace-only order ID" },
]
const invalidOptionalIdInputs = [
  { clientOrderId: "", description: "empty client order ID" },
  { clientOrderId: "   ", description: "whitespace-only client order ID" },
  { clientOrderId: 42, description: "numeric client order ID" },
]
const invalidQuantityInputs = [
  { quantity: "0.1", description: "string quantity" },
  { quantity: NaN, description: "NaN quantity" },
  { quantity: Infinity, description: "infinite quantity" },
  { quantity: -1, description: "negative quantity" },
]

test("Order constructor rejects invalid prices with its domain Error", () => {
  for (const { price, description } of invalidPriceInputs) {
    assert.throws(
      () => new Order({ ...validOrderInput, price }),
      {
        name: "Error",
        message: errMsgs.price,
      },
      `Order must reject ${description} with its stable price error`,
    )
  }
})

test("Order constructor rejects invalid required IDs with its domain Error", () => {
  for (const { id, description } of invalidRequiredIdInputs) {
    assert.throws(
      () => new Order({ ...validOrderInput, id }),
      {
        name: "Error",
        message: errMsgs.id,
      },
      `Order must reject ${description} with its stable identity error`,
    )
  }
})

test("Order constructor rejects invalid optional client IDs with its domain Error", () => {
  for (const { clientOrderId, description } of invalidOptionalIdInputs) {
    assert.throws(
      () => new Order({ ...validOrderInput, clientOrderId }),
      {
        name: "Error",
        message: errMsgs.clientOrderId,
      },
      `Order must reject ${description} with its stable client-order identity error`,
    )
  }
})

test("Order constructor rejects invalid quantities with its domain Error", () => {
  for (const { quantity, description } of invalidQuantityInputs) {
    assert.throws(
      () => new Order({ ...validOrderInput, quantity }),
      {
        name: "Error",
        message: errMsgs.quantity,
      },
      `Order must reject ${description} with its stable quantity error`,
    )
  }
})

test("Order constructor accepts null optional ID and valid domain values", () => {
  const orderWithoutClientId = new Order({
    ...validOrderInput,
    quantity: 0,
    clientOrderId: null,
  })
  const orderWithClientId = new Order({
    ...validOrderInput,
    clientOrderId: "client-id",
  })

  assert.equal(
    orderWithoutClientId.clientOrderId,
    undefined,
    "Order must normalize a null optional client ID to undefined",
  )
  assert.equal(
    orderWithoutClientId.quantity,
    0,
    "Order must preserve the valid zero quantity",
  )
  assert.equal(
    orderWithClientId.clientOrderId,
    "client-id",
    "Order must preserve a valid optional client ID",
  )
})
