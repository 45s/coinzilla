import test from "node:test"
import assert from "node:assert/strict"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { makeProcessMarketPrice } from "./process-market-price.js"

const priceEvent = {
  eventType: "aggTrade",
  symbol: "BTCUSDT",
  price: "65000.12",
  timestamp: 123,
}

test("passes validated price, pair settings, and Portfolio to the strategy", async () => {
  const pairConfig = { enabled: true, orderQuantity: 0.01 }
  const settings = { minProfit: 0.01 }
  const portfolio = new Portfolio()
  let received
  const processMarketPrice = makeProcessMarketPrice({
    strategy: {
      evaluate: async (input) => {
        received = input
        return { action: "NO_ACTION" }
      },
    },
  })
  const result = await processMarketPrice({ symbol: "BTCUSDT", priceEvent, pairConfig, settings, portfolio })

  assert.equal(result.ok, true)
  assert.deepEqual(received, {
    marketPrice: { symbol: "BTCUSDT", price: "65000.12", timestamp: 123 },
    pairConfig,
    settings,
    portfolio,
  })
  assert.deepEqual(result.data.decision, { action: "NO_ACTION" })
})

test("rejects a price event routed to a different subscribed market", async () => {
  const processMarketPrice = makeProcessMarketPrice({ strategy: { evaluate: () => ({ action: "NO_ACTION" }) } })
  const result = await processMarketPrice({ symbol: "ETHUSDT", priceEvent, pairConfig: {}, settings: {} })
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /while subscribed to ETHUSDT/)
})

test("returns a failed result for invalid broker price events", async () => {
  const processMarketPrice = makeProcessMarketPrice({ strategy: { evaluate: () => ({ action: "NO_ACTION" }) } })
  const result = await processMarketPrice({
    symbol: "BTCUSDT",
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
  const result = await processMarketPrice({ symbol: "BTCUSDT", priceEvent, pairConfig: {}, settings: {} })
  assert.equal(result.ok, false)
  assert.equal(result.errors[0].message, "strategy failed")
})

test("rejects a non-Portfolio strategy context", async () => {
  const processMarketPrice = makeProcessMarketPrice({ strategy: { evaluate: () => ({ action: "NO_ACTION" }) } })
  const result = await processMarketPrice({
    symbol: "BTCUSDT",
    priceEvent,
    pairConfig: {},
    settings: {},
    portfolio: {},
  })
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /requires a Portfolio/)
})

test("requires an explicit strategy contract", () => {
  assert.throws(() => makeProcessMarketPrice(), /strategy with evaluate/)
})
