import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { getPrices } from "./get-prices.js"

describe("Binance getPrices API errors", () => {
  it("rejects Binance error responses", async () => {
    const originalFetch = globalThis.fetch
    const apiError = { code: -1121, msg: "Invalid symbol." }

    globalThis.fetch = async () => ({
      headers: { get: () => "application/json" },
      json: async () => apiError,
      text: async () => "",
    })

    try {
      await assert.rejects(
        () => getPrices({ tickets: ["NOTREAL"] }),
        (error) => error === apiError,
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})