import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { getPrices } from "./get-prices.js"

describe("Binance getPrices network failures", () => {
  it("propagates fetch failures", async () => {
    const originalFetch = globalThis.fetch
    const networkError = new TypeError("network unavailable")

    globalThis.fetch = async () => {
      throw networkError
    }

    try {
      await assert.rejects(
        () => getPrices({ tickets: ["BTCUSDT"] }),
        (error) => error === networkError,
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})