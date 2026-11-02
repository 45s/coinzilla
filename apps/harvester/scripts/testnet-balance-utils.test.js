import assert from "node:assert/strict"
import test from "node:test"

import { getNonZeroBalances } from "./testnet-balance-utils.js"

test("getNonZeroBalances returns only assets with free or locked funds", () => {
  const { balances } = getNonZeroBalances({
    balances: [
      { asset: "ZRO", free: "249.85000000", locked: "0.00000000" },
      { asset: "USDT", free: "0.00000000", locked: "12.50000000" },
      { asset: "DOGE", free: "0.00000000", locked: "0.00000000" },
    ],
  })

  assert.deepEqual(balances, [
    { asset: "ZRO", free: "249.85000000", locked: "0.00000000" },
    { asset: "USDT", free: "0.00000000", locked: "12.50000000" },
  ])
})

test("getNonZeroBalances preserves exact exchange decimal strings", () => {
  const { balances } = getNonZeroBalances({
    balances: [{ asset: "BTC", free: "0.00000001", locked: "0" }],
  })

  assert.equal(balances[0].free, "0.00000001")
})

test("getNonZeroBalances rejects malformed account balances", () => {
  assert.throws(
    () => getNonZeroBalances({ balances: [{ asset: "ZRO", free: "NaN", locked: "0" }] }),
    /invalid asset balance/,
  )
  assert.throws(() => getNonZeroBalances({ balances: null }), /must be an array/)
})
