import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import { cancelOrder } from "./cancel-order.js"

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

describe("cancelOrder", () => {
  it("sends a DELETE request and returns the exchange response", async () => {
    let request
    globalThis.fetch = async (url, options) => {
      request = { url: String(url), options }
      return {
        headers: { get: () => "application/json" },
        json: async () => ({ symbol: "BTCUSDT", status: "CANCELED" }),
      }
    }

    const result = await cancelOrder({ symbol: "BTCUSDT", orderId: 123 })

    assert.equal(request.options.method, "DELETE")
    assert.match(request.url, /order\?symbol=BTCUSDT&orderId=123&/)
    assert.match(request.url, /signature=/)
    assert.deepEqual(result, { symbol: "BTCUSDT", status: "CANCELED" })
  })

  it("throws the exchange error response", async () => {
    globalThis.fetch = async () => ({
      headers: { get: () => "application/json" },
      json: async () => ({ code: -2011, msg: "Unknown order sent." }),
    })

    await assert.rejects(
      () => cancelOrder({ symbol: "BTCUSDT", orderId: 123 }),
      (error) => error.code === -2011 && error.msg === "Unknown order sent.",
    )
  })
})
