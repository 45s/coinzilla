import assert from "node:assert/strict"
import { it } from "node:test"
import { getPrices } from "./get-prices.js"

it("fetches ticker prices from Binance", async () => {
  const prices = await getPrices({
    tickets: ["ZKUSDT", "ZKFDUSD", "BTCFDUSD"],
  })

  assert.ok(Array.isArray(prices))
  assert.ok(prices.length > 0)
  assert.ok(prices.every(({ symbol, price }) => symbol && Number.isFinite(price)))
})
