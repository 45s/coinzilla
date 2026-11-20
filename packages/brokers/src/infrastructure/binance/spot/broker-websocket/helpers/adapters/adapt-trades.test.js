import assert from "node:assert/strict"
import test from "node:test"
import { adaptAggTrades } from "./adapt-trades.js"

test("maps Binance aggregate-trade fields to the canonical shape", () => {
  const message = {
    e: "aggTrade",
    E: 1700000000000,
    T: 1700000000001,
    s: "BTCUSDT",
    p: "100.25",
    q: "0.5",
    m: true,
    M: false,
    a: 12,
    f: 10,
    l: 11,
  }

  assert.deepEqual(adaptAggTrades(message), {
    eventType: "aggTrade",
    eventTime: 1700000000000,
    timestamp: 1700000000001,
    symbol: "BTCUSDT",
    price: "100.25",
    quantity: "0.5",
    isBuyerMaker: true,
    wasBestPrice: false,
    aggId: 12,
    firstId: 10,
    lastId: 11,
  })
})
