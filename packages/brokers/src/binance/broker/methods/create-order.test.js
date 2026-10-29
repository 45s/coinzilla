import assert from "node:assert/strict"
import { describe, it } from "node:test"
process.env.BINANCE_API_SECRET_KEY = "unit-test-secret"
process.env.BINANCE_API_KEY = "unit-test-key"
process.env.BINANCE_SPOT_API_URL = "https://example.test"
const { createOrder } = await import("./create-order.js")

const order = {
  symbol: "BTCUSDT",
  type: "LIMIT",
  side: "BUY",
  price: 50000,
  quantity: 0.25,
}

describe("createOrder", () => {
  it("sends a signed POST request and adapts the created order", async (t) => {
    let request
    t.mock.method(globalThis, "fetch", async (url, options) => {
      request = { url: String(url), options }
      return {
        headers: { get: () => "application/json" },
        json: async () => ({
          symbol: "BTCUSDT", orderId: 42, type: "LIMIT", side: "BUY",
          price: "50000", origQty: "0.25", executedQty: "0",
        }),
      }
    })

    const result = await createOrder({ order })
    assert.equal(request.options.method, "POST")
    assert.match(request.url, /order\?symbol=BTCUSDT&type=LIMIT&side=BUY/)
    assert.match(request.url, /timeInForce=GTC/)
    assert.match(request.url, /signature=/)
    assert.equal(result.id, "42")
    assert.equal(result.quantity, 0.25)
    assert.equal(result.price, 50000)
  })

  it("includes clientOrderId in the signed request as newClientOrderId", async (t) => {
    let requestUrl
    t.mock.method(globalThis, "fetch", async (url) => {
      requestUrl = String(url)
      return {
        headers: { get: () => "application/json" },
        json: async () => ({
          symbol: "BTCUSDT", orderId: 44, type: "LIMIT", side: "BUY",
          price: "50000", origQty: "0.25", executedQty: "0",
        }),
      }
    })

    await createOrder({ order: { ...order, clientOrderId: "FR_BTC_0001" } })

    assert.match(requestUrl, /newClientOrderId=FR_BTC_0001/)
    const signedQuery = requestUrl.match(/order\?(.+)&signature=/)?.[1]
    assert.ok(signedQuery)
    assert.match(signedQuery, /newClientOrderId=FR_BTC_0001/)
  })

  it("does not add newClientOrderId when it is omitted", async (t) => {
    let requestUrl
    t.mock.method(globalThis, "fetch", async (url) => {
      requestUrl = String(url)
      return {
        headers: { get: () => "application/json" },
        json: async () => ({
          symbol: "BTCUSDT", orderId: 45, type: "LIMIT", side: "BUY",
          price: "50000", origQty: "0.25", executedQty: "0",
        }),
      }
    })

    await createOrder({ order })

    assert.doesNotMatch(requestUrl, /newClientOrderId=/)
  })

  it("throws the exchange error response", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      headers: { get: () => "application/json" },
      json: async () => ({ code: -1013, msg: "Invalid quantity." }),
    }))
    await assert.rejects(
      () => createOrder({ order }),
      (error) => error.code === -1013 && error.msg === "Invalid quantity.",
    )
  })
})

it("returns remaining quantity for a partially filled order response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    headers: { get: () => "application/json" },
    json: async () => ({
      symbol: "BTCUSDT", orderId: 43, type: "LIMIT", side: "BUY",
      price: "50000", origQty: "0.25", executedQty: "0.1",
    }),
  }))
  const result = await createOrder({ order })
  assert.equal(result.quantity, 0.15)
})
