import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
process.env.BINANCE_API_SECRET_KEY = "unit-test-secret"
process.env.BINANCE_API_KEY = "unit-test-key"
process.env.BINANCE_SPOT_API_URL = "https://example.test"
const { getOrder } = await import("./get-order.js")

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

describe("getOrder", () => {
  it("requests the specified order and adapts its response", async () => {
    let requestedUrl
    globalThis.fetch = async (url) => {
      requestedUrl = String(url)
      return {
        headers: { get: () => "application/json" },
        json: async () => ({
          symbol: "ETHUSDT", orderId: 99, type: "LIMIT", side: "BUY",
          price: "2500.5", origQty: "3", executedQty: "1",
        }),
      }
    }

    const result = await getOrder({ symbol: "ETHUSDT", orderId: 99 })

    assert.match(requestedUrl, /order\?symbol=ETHUSDT&orderId=99&/)
    assert.match(requestedUrl, /signature=/)
    assert.equal(result.id, "99")
    assert.equal(result.symbol, "ETHUSDT")
    assert.equal(result.quantity, 2)
    assert.equal(result.price, 2500.5)
  })

  it("throws the exchange error response", async () => {
    globalThis.fetch = async () => ({
      headers: { get: () => "application/json" },
      json: async () => ({ code: -2013, msg: "Order does not exist." }),
    })

    await assert.rejects(
      () => getOrder({ symbol: "ETHUSDT", orderId: 99 }),
      (error) => error.code === -2013 && error.msg === "Order does not exist.",
    )
  })
})
