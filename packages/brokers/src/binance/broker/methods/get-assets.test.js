import assert from "node:assert/strict"
import { describe, it } from "node:test"
process.env.BINANCE_API_SECRET_KEY = "unit-test-secret"
process.env.BINANCE_API_KEY = "unit-test-key"
process.env.BINANCE_SPOT_API_URL = "https://example.test"
const { getAssets } = await import("./get-assets.js")

describe("getAssets", () => {
  it("adapts non-zero account balances", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      headers: { get: () => "application/json" },
      json: async () => ({
        balances: [
          { asset: "BTC", free: "0.25", locked: "0.05" },
          { asset: "USDT", free: "0", locked: "0" },
        ],
      }),
    }))

    const result = await getAssets()
    assert.deepEqual(result, [{ ticker: "BTC", quantity: 0.3 }])
  })

  it("throws a useful error when Binance returns an API message", async (t) => {
    t.mock.method(console, "error", () => {})
    t.mock.method(globalThis, "fetch", async () => ({
      headers: { get: () => "application/json" },
      json: async () => ({ code: -1003, msg: "Too many requests." }),
    }))

    await assert.rejects(() => getAssets(), { message: "Too many requests." })
  })
})

it("returns an empty list when the account has no balances", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    headers: { get: () => "application/json" },
    json: async () => ({ balances: [] }),
  }))
  assert.deepEqual(await getAssets(), [])
})
