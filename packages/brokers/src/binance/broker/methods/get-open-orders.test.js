import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
process.env.BINANCE_API_SECRET_KEY = "unit-test-secret"
process.env.BINANCE_API_KEY = "unit-test-key"
process.env.BINANCE_SPOT_API_URL = "https://example.test"
const { getOpenOrders } = await import("./get-open-orders.js")

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

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
  it("adapts each returned open order", async () => {
    globalThis.fetch = async () => ({
      headers: { get: () => "application/json" },
      json: async () => [exchangeOrder(1), exchangeOrder(2, { origQty: "2" })],
    })

    const result = await getOpenOrders()
    assert.equal(result.length, 2)
    assert.deepEqual(result.map((item) => item.id), ["1", "2"])
    assert.deepEqual(result.map((item) => item.quantity), [1, 2])
  })

  it("throws the exchange error response", async () => {
    globalThis.fetch = async () => ({
      headers: { get: () => "application/json" },
      json: async () => ({ code: -1003, msg: "Rate limit exceeded." }),
    })

    await assert.rejects(
      () => getOpenOrders(),
      (error) => error.code === -1003 && error.msg === "Rate limit exceeded.",
    )
  })
})
