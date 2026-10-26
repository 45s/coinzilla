import assert from "node:assert"
import { describe, it } from "node:test"
import { EM } from "@coinzilla/utils"
import { getPrices } from "./get-prices.js"

describe("BinanceBroker/getPrices", () => {
  it("should validate input", () => {
    assert.rejects(
      async () =>
        await getPrices({ tickets: undefined }, { msgs: [EM.required()] }),
    )
  })

  it("should return prices", async () => {
    const r = await getPrices({ tickets: ["ZKUSDT", "ZKFDUSD", "BTCFDUSD"] })
    assert(Array.isArray(r))
  })
})
