import assert from "node:assert/strict"
import test from "node:test"
import { adaptAssets } from "./adapt-assets.js"

test("adapts Bitunix Spot balances to legacy Coin values and omits zero assets", () => {
  const input = [
    {
      coin: "BTC",
      balance: "0.1",
      balanceLocked: "0.2",
    },
    {
      coin: "USDT",
      balance: "12.5",
      balanceLocked: "0",
    },
    {
      coin: "ZERO",
      balance: "0",
      balanceLocked: "0.000",
    },
  ]
  const original = structuredClone(input)

  assert.deepEqual(adaptAssets(input), [
    { ticker: "BTC", quantity: 0.3 },
    { ticker: "USDT", quantity: 12.5 },
  ])
  assert.deepEqual(input, original)
})

test("rejects malformed Bitunix balances through canonical balance validation", () => {
  assert.throws(() => adaptAssets([
    {
        coin: "BTC",
      balance: 0.1,
      balanceLocked: "0",
    },
  ]), /precision-preserving/i)
  assert.throws(() => adaptAssets([
    {
      coin: "BTC",
      balance: "-1",
      balanceLocked: "0",
    },
  ]), /non-negative/i)
})
