import test from "node:test"
import assert from "node:assert/strict"
import { makePlaceOrder } from "./place-order.js"

test("submits an approved order through the injected broker port", async () => {
  const order = { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "0.01", price: "50000" }
  const brokerResult = { ok: true, data: { orderId: "123" } }
  const calls = []
  const placeOrder = makePlaceOrder({
    broker: {
      placeOrder: async (input) => {
        calls.push(input)
        return brokerResult
      },
    },
  })

  assert.equal(await placeOrder({ order }), brokerResult)
  assert.deepEqual(calls, [{ order }])
})

test("returns a result error for a missing or invalid order", async () => {
  const placeOrder = makePlaceOrder({ broker: { placeOrder: async () => ({ ok: true }) } })

  const result = await placeOrder({ order: null })

  assert.equal(result.ok, false)
  assert.ok(result.errors[0] instanceof TypeError)
})

test("requires a broker port when the use case is constructed", () => {
  assert.throws(() => makePlaceOrder({ broker: {} }), /broker port/)
})

test("propagates thrown broker errors so uncertain outcomes are not disguised", async () => {
  const brokerError = new Error("Order result is unknown")
  const placeOrder = makePlaceOrder({
    broker: {
      placeOrder: async () => {
        throw brokerError
      },
    },
  })

  await assert.rejects(placeOrder({ order: { symbol: "BTCUSDT" } }), brokerError)
})
