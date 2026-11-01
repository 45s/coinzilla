import test from "node:test"
import assert from "node:assert/strict"
import { makeProcessMarketPrice } from "./process-market-price.js"

const priceEvent = {
  eventType: "aggTrade",
  symbol: "BTCUSDT",
  price: "65000.12",
  timestamp: 123,
}

test("passes validated market price and pair settings to the strategy", async () => {
  const pairConfig = { enabled: true, orderQuantity: 0.01 }
  const settings = { minProfit: 0.01 }
  let received
  const processMarketPrice = makeProcessMarketPrice({
    strategy: {
      evaluate: async (input) => {
        received = input
        return { action: "WAIT" }
      },
    },
  })

  const result = await processMarketPrice({ priceEvent, pairConfig, settings })

  assert.equal(result.ok, true)
  assert.deepEqual(received, {
    marketPrice: { symbol: "BTCUSDT", price: "65000.12", timestamp: 123 },
    pairConfig,
    settings,
  })
  assert.deepEqual(result.data.decision, { action: "WAIT" })
})

test("returns a failed result for invalid broker price events", async () => {
  const processMarketPrice = makeProcessMarketPrice({
    strategy: { evaluate: () => ({ action: "WAIT" }) },
  })

  const result = await processMarketPrice({
    priceEvent: { ...priceEvent, price: "invalid" },
    pairConfig: {},
    settings: {},
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /positive decimal/)
})

test("returns strategy failures instead of swallowing them", async () => {
  const processMarketPrice = makeProcessMarketPrice({
    strategy: { evaluate: async () => { throw new Error("strategy failed") } },
  })

  const result = await processMarketPrice({ priceEvent, pairConfig: {}, settings: {} })

  assert.equal(result.ok, false)
  assert.equal(result.errors[0].message, "strategy failed")
})

test("requires an explicit strategy contract", () => {
  assert.throws(() => makeProcessMarketPrice(), /strategy with evaluate/)
})
