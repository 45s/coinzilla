import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { adaptCanonicalFill } from "./adapt-canonical-fill.js"

const baseAsset = new Asset({ id: "btc", code: "BTC" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset,
  quoteAsset,
})

const trade = {
  id: 42,
  orderId: 7,
  isBuyer: true,
  isMaker: false,
  price: "65000.12000000",
  qty: "0.00010001",
  quoteQty: "6.5060120012",
  commission: "0.00000001",
  commissionAsset: "BNB",
  time: 1_798_000_000_000,
}

describe("adaptCanonicalFill", () => {
  it("maps exact Binance execution values into canonical Fill and Commission entities", () => {
    const fill = adaptCanonicalFill({ trade, market })

    assert.ok(fill instanceof Fill)
    assert.equal(fill.id, "binance:BTCUSDT:42")
    assert.equal(fill.tradeId, "42")
    assert.equal(fill.brokerOrderId, "7")
    assert.equal(fill.side, "BUY")
    assert.equal(fill.price.amount, "65000.12")
    assert.equal(fill.price.asset.id, "usdt")
    assert.equal(fill.quantity.amount, "0.00010001")
    assert.strictEqual(fill.quantity.asset, baseAsset)
    assert.equal(fill.quoteQuantity.amount, "6.5060120012")
    assert.equal(fill.liquidityRole, "TAKER")
    assert.equal(fill.executedAt, 1_798_000_000_000)
    assert.equal(fill.commissionStatus, "COMPLETE")
    assert.equal(fill.commissions.length, 1)
    assert.ok(fill.commissions[0] instanceof Commission)
    assert.ok(fill.commissions[0].amount instanceof Money)
    assert.equal(fill.commissions[0].amount.amount, "0.00000001")
    assert.equal(fill.commissions[0].amount.asset.id, "bnb")
    assert.deepEqual(fill.value.commissions[0].amount, {
      amount: "0.00000001",
      asset: { id: "bnb", code: "BNB" },
    })
  })

  it("reuses market asset identity for commissions paid in a market asset", () => {
    const fill = adaptCanonicalFill({
      trade: { ...trade, commission: "0.00000001", commissionAsset: "BTC" },
      market,
    })

    assert.strictEqual(fill.commissions[0].amount.asset, baseAsset)
  })

  it("represents a confirmed zero commission as complete with no fee entries", () => {
    const fill = adaptCanonicalFill({
      trade: { ...trade, commission: "0", commissionAsset: null },
      market,
    })

    assert.equal(fill.commissionStatus, "COMPLETE")
    assert.deepEqual(fill.commissions, [])
  })

  it("does not invent a fee asset when a positive commission lacks its asset", () => {
    const fill = adaptCanonicalFill({
      trade: { ...trade, commission: "0.01", commissionAsset: null },
      market,
    })

    assert.equal(fill.commissionStatus, "UNKNOWN")
    assert.deepEqual(fill.commissions, [])
  })

  it("uses UNKNOWN for missing maker/taker metadata and omits absent timestamps", () => {
    const fill = adaptCanonicalFill({
      trade: { ...trade, isMaker: undefined, time: undefined },
      market,
    })

    assert.equal(fill.liquidityRole, "UNKNOWN")
    assert.equal(fill.executedAt, undefined)
  })

  it("rejects malformed trade identity, side, values, and market input", () => {
    for (const input of [
      { trade: null, market },
      { trade: { ...trade, id: null }, market },
      { trade: { ...trade, orderId: null }, market },
      { trade: { ...trade, isBuyer: "true" }, market },
      { trade: { ...trade, price: "not-a-price" }, market },
      { trade: { ...trade, qty: "-1" }, market },
      { trade: { ...trade, quoteQty: "0" }, market },
      { trade: { ...trade, commission: "-0.01", commissionAsset: null }, market },
      { trade, market: {} },
    ]) {
      assert.throws(() => adaptCanonicalFill(input))
    }
  })

  it("does not convert financial values through JavaScript Number", () => {
    const fill = adaptCanonicalFill({
      trade: {
        ...trade,
        price: "9007199254740993.00000001",
        qty: "0.00000003",
        quoteQty: "270215977642229.7900000003",
        commission: "0.000000000000000001",
      },
      market,
    })

    assert.ok(fill.quantity instanceof Quantity)
    assert.equal(fill.price.amount, "9007199254740993.00000001")
    assert.equal(fill.quoteQuantity.amount, "270215977642229.7900000003")
    assert.equal(fill.commissions[0].amount.amount, "0.000000000000000001")
  })
})
