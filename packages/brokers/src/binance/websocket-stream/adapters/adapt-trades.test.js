import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { adaptAggTrades } from "./adapt-trades.js"

describe("adaptAggTrades", () => {
  it("maps aggregate trade fields without coercing decimal strings", () => {
    const message = {
      e: "aggTrade", E: 100, T: 99, s: "BTCUSDT", p: "65000.1000", q: "0.2500",
      m: true, M: false, a: 123, f: 120, l: 124,
    }

    assert.deepEqual(adaptAggTrades(message), {
      eventType: "aggTrade", eventTime: 100, timestamp: 99, symbol: "BTCUSDT",
      price: "65000.1000", quantity: "0.2500", isBuyerMaker: true,
      wasBestPrice: false, aggId: 123, firstId: 120, lastId: 124,
    })
  })
})