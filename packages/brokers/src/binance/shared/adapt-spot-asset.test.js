import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { adaptSpotAsset } from "./adapt-spot-asset.js"

describe("adaptSpotAsset", () => {
  it("combines free and locked balances", () => {
    assert.deepEqual(adaptSpotAsset([
      { asset: "BTC", free: "0.25", locked: "0.05" },
      { asset: "USDT", free: "100", locked: "20" },
    ]), [
      { ticker: "BTC", quantity: 0.3 },
      { ticker: "USDT", quantity: 120 },
    ])
  })

  it("omits zero-balance assets", () => {
    assert.deepEqual(adaptSpotAsset([
      { asset: "BTC", free: "0", locked: "0" },
      { asset: "ETH", free: "0.5", locked: "0" },
    ]), [
      { ticker: "ETH", quantity: 0.5 },
    ])
  })

  it("removes the LD prefix from Binance earn asset tickers", () => {
    const result = adaptSpotAsset([
      { asset: "LDBTC", free: "0.1", locked: "0.02" },
      { asset: "LDUSDT", free: "5", locked: "0" },
    ])

    assert.equal(result[0].ticker, "BTC")
    assert.ok(Math.abs(result[0].quantity - 0.12) < Number.EPSILON)
    assert.deepEqual(result[1], { ticker: "USDT", quantity: 5 })
  })

  it("does not modify the input balances", () => {
    const balances = [{ asset: "BTC", free: "1", locked: "0.25" }]
    const original = structuredClone(balances)

    adaptSpotAsset(balances)

    assert.deepEqual(balances, original)
  })
})

it("returns an empty list for an empty balance response", () => {
  assert.deepEqual(adaptSpotAsset([]), [])
})

it("rejects malformed numeric balance values instead of silently dropping them", () => {
  assert.throws(
    () => adaptSpotAsset([{ asset: "BTC", free: "unknown", locked: "0" }]),
    { name: "TypeError", message: 'Invalid balance quantity for asset "BTC"' },
  )
})
