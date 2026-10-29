import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { getPrices } from "./get-prices.js"

describe("Binance getPrices network failures", () => {
  it("propagates fetch failures", async (t) => {
    const networkError = new TypeError("network unavailable")
    t.mock.method(globalThis, "fetch", async () => {
      throw networkError
    })

    await assert.rejects(
      () => getPrices({ tickets: ["BTCUSDT"] }),
      (error) => error === networkError,
    )
  })
})
