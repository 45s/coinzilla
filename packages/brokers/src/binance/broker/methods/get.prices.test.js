import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { getPrices } from "./get-prices.js"

describe("BinanceBroker/getPrices", () => {
  it("rejects missing tickets", async () => {
    await assert.rejects(() => getPrices({ tickets: undefined }))
  })

  it("rejects an empty ticket list", async () => {
    await assert.rejects(() => getPrices({ tickets: [] }))
  })

  it("rejects non-array tickets", async () => {
    await assert.rejects(() => getPrices({ tickets: "BTCUSDT" }))
  })
})
