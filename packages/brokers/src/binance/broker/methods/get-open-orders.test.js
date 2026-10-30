import assert from "node:assert/strict"
import { describe, it } from "node:test"
process.env.BINANCE_API_SECRET_KEY = "unit-test-secret"
process.env.BINANCE_API_KEY = "unit-test-key"
process.env.BINANCE_SPOT_API_URL = "https://example.test"
const { getOpenOrders } = await import("./get-open-orders.js")

const exchangeOrder = (orderId, overrides = {}) => ({
  symbol: "BTCUSDT",
  orderId,
  type: "LIMIT",
  side: "SELL",
  price: "50000",
  origQty: "1",
  executedQty: "0",
  ...overrides,
})

describe("getOpenOrders", () => {
  it("adapts each returned open order", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      headers: { get: () => "application/json" },
      json: async () => [exchangeOrder(1), exchangeOrder(2, { origQty: "2" })],
    }))

    const result = await getOpenOrders()
    assert.equal(result.length, 2)
    assert.deepEqual(result.map((item) => item.id), ["1", "2"])
    assert.deepEqual(result.map((item) => item.quantity), [1, 2])
  })

  it("throws the exchange error response", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      headers: { get: () => "application/json" },
      json: async () => ({ code: -1003, msg: "Rate limit exceeded." }),
    }))

    await assert.rejects(
      () => getOpenOrders(),
      (error) => error.code === -1003 && error.msg === "Rate limit exceeded.",
    )
  })

  it("filters open orders by symbol and signs the complete query", async (t) => {
    let requestedUrl
    t.mock.method(globalThis, "fetch", async (url) => {
      requestedUrl = String(url)
      return {
        headers: { get: () => "application/json" },
        json: async () => [exchangeOrder(3)],
      }
    })

    const result = await getOpenOrders({ symbol: "BTCUSDT" })

    assert.equal(result.length, 1)
    assert.match(requestedUrl, /openOrders\?symbol=BTCUSDT&recvWindow=5000&timestamp=\d+&signature=/)
  })
})

it("returns an empty list when no open orders exist", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    headers: { get: () => "application/json" },
    json: async () => [],
  }))
  assert.deepEqual(await getOpenOrders(), [])
})
