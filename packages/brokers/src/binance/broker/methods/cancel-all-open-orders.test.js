import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { EM } from "@coinzilla/utils"

process.env.BINANCE_API_SECRET_KEY = "unit-test-secret"
process.env.BINANCE_API_KEY = "unit-test-key"
process.env.BINANCE_SPOT_API_URL = "https://example.test"
const { cancelAllOpenOrders } = await import("./cancel-all-open-orders.js")

describe("BinanceBroker/cancelAllOpenOrders", () => {
  it("should validate input", () => {
    assert.rejects(
      async () =>
        await cancelAllOpenOrders(
          { ticket: undefined },
          { msgs: [EM.required()] },
        ),
    )
  })

  it("URL-encodes the symbol before signing the cancellation query", async (t) => {
    let requestedUrl
    t.mock.method(globalThis, "fetch", async (url) => {
      requestedUrl = String(url)
      return {
        headers: { get: () => "application/json" },
        json: async () => [],
      }
    })

    const result = await cancelAllOpenOrders({ ticket: "BTC USDT&x=1" })

    assert.equal(result.isOk, true)
    assert.match(requestedUrl, /symbol=BTC%20USDT%26x%3D1&/)
    const signedQuery = requestedUrl.match(/openOrders\?(.+)&signature=/)?.[1]
    assert.ok(signedQuery)
    assert.match(signedQuery, /symbol=BTC%20USDT%26x%3D1&/)
  })

  it.skip("should cancel open orders", async () => {
    const r = await cancelAllOpenOrders({ ticket: "BTCUSDT" })
    assert(Array.isArray(r))
  })
})
