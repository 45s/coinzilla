import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import { createOrder } from "./create-order.js"

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

const order = {
  symbol: "BTCUSDT",
  type: "LIMIT",
  side: "BUY",
  price: 50000,
  quantity: 0.25,
}

describe("createOrder", () => {
  it("sends a signed POST request and adapts the created order", async () => {
    let request
    globalThis.fetch = async (url, options) => {
      request = { url: String(url), options }
      return {
        headers: { get: () => "application/json" },
        json: async () => ({
          symbol: "BTCUSDT", orderId: 42, type: "LIMIT", side: "BUY",
          price: "50000", origQty: "0.25", executedQty: "0",
        }),
      }
    }

    const result = await createOrder({ order })

    assert.equal(request.options.method, "POST")
    assert.match(request.url, /order\?symbol=BTCUSDT&type=LIMIT&side=BUY/)
    assert.match(request.url, /timeInForce=GTC/)
    assert.match(request.url, /signature=/)
    assert.equal(result.id, "42")
    assert.equal(result.quantity, 0.25)
    assert.equal(result.price, 50000)
  })

  it("throws the exchange error response", async () => {
    globalThis.fetch = async () => ({
      headers: { get: () => "application/json" },
      json: async () => ({ code: -1013, msg: "Invalid quantity." }),
    })

    await assert.rejects(
      () => createOrder({ order }),
      (error) => error.code === -1013 && error.msg === "Invalid quantity.",
    )
  })
})
