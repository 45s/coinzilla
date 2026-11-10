import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { adaptTrade } from "./adapt-fill.js"

const baseTrade = {
  id: 123,
  orderId: 456,
  symbol: "BTCUSDT",
  isBuyer: true,
  isMaker: true,
  price: "65000.12000000",
  qty: "0.00010001",
  quoteQty: "6.5060120012",
  commission: "0.00000001",
  commissionAsset: "BNB",
  time: 1_798_000_000_000,
}

describe("adaptTrade", () => {
  it("maps Binance trade IDs, side, exact decimal strings, fee, and timestamp", () => {
    assert.deepEqual(adaptTrade(baseTrade), {
      id: "123",
      orderId: "456",
      symbol: "BTCUSDT",
      side: "BUY",
      price: "65000.12000000",
      quantity: "0.00010001",
      quoteQuantity: "6.5060120012",
      commissionAmount: "0.00000001",
      commissionAsset: "BNB",
      isMaker: true,
      time: 1_798_000_000_000,
    })
  })

  it("maps sell trades and normalizes numeric exchange IDs to exact strings", () => {
    const trade = adaptTrade({
      ...baseTrade,
      id: 0,
      orderId: 7,
      isBuyer: false,
      isMaker: false,
      price: 12.5,
      qty: 2,
      quoteQty: 25,
      commission: 0,
    })

    assert.deepEqual(trade, {
      id: "0",
      orderId: "7",
      symbol: "BTCUSDT",
      side: "SELL",
      price: "12.5",
      quantity: "2",
      quoteQuantity: "25",
      commissionAmount: "0",
      commissionAsset: "BNB",
      isMaker: false,
      time: 1_798_000_000_000,
    })
  })

  it("uses null for omitted optional commission asset and trade time", () => {
    const { commissionAsset, time, ...tradeWithoutOptionalFields } = baseTrade
    const result = adaptTrade(tradeWithoutOptionalFields)

    assert.equal(result.commissionAsset, null)
    assert.equal(result.time, null)
  })

  it("rejects non-object trades and every missing required field", () => {
    assert.throws(() => adaptTrade(null), /must be an object/)
    assert.throws(() => adaptTrade("trade"), /must be an object/)

    for (const field of ["id", "orderId", "symbol", "price", "qty", "quoteQty", "commission"]) {
      const trade = { ...baseTrade }
      delete trade[field]
      assert.throws(() => adaptTrade(trade), new RegExp(`missing ${field}`))
    }

    assert.throws(() => adaptTrade({ ...baseTrade, id: null }), /missing id/)
  })

  it("requires boolean buyer and maker flags and exact non-negative IDs", () => {
    assert.throws(() => adaptTrade({ ...baseTrade, isBuyer: "true" }), /isBuyer and isMaker flags/)
    assert.throws(() => adaptTrade({ ...baseTrade, isMaker: 1 }), /isBuyer and isMaker flags/)
    assert.throws(() => adaptTrade({ ...baseTrade, id: -1 }), /trade ID must be an exact non-negative integer/)
    assert.throws(() => adaptTrade({ ...baseTrade, orderId: "1.5" }), /order ID must be an exact non-negative integer/)
  })
})
