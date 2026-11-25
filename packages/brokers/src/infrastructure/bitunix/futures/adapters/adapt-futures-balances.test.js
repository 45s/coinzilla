import assert from "node:assert/strict"
import test from "node:test"

import { Balance } from "@coinzilla/entities"
import { adaptFuturesBalances } from "./adapt-futures-balances.js"

test("adaptFuturesBalances adds order-frozen and position-margin amounts exactly", () => {
  const balances = adaptFuturesBalances({
    marginCoin: "USDT",
    rows: [{
      marginCoin: "USDT",
      available: "1.200000000000000001",
      frozen: "0.1",
      margin: "0.2",
      bonus: "100",
    }],
  })

  assert.equal(balances.length, 1, "one matching margin account must produce one canonical balance")
  assert.ok(balances[0] instanceof Balance, "the adapter must return the shared Balance entity")
  assert.equal(balances[0].free.amount, "1.200000000000000001", "available funds must retain exact decimal precision")
  assert.equal(balances[0].locked.amount, "0.3", "order-frozen and position-margin amounts must be combined")
  assert.equal(balances[0].total.amount, "1.500000000000000001", "promotional bonus must not be included in account custody")
})

test("adaptFuturesBalances rejects missing and duplicate margin-account rows", () => {
  assert.throws(
    () => adaptFuturesBalances({
      marginCoin: "USDT",
      rows: [],
    }),
    /does not contain USDT margin account/,
    "missing margin account data must not become a zero balance",
  )
  assert.throws(
    () => adaptFuturesBalances({
      marginCoin: "USDT",
      rows: [
        {
          marginCoin: "USDT",
          available: "1",
          frozen: "0",
          margin: "0",
        },
        {
          marginCoin: "USDT",
          available: "2",
          frozen: "0",
          margin: "0",
        },
      ],
    }),
    /duplicate USDT margin accounts/,
    "duplicate account rows must fail closed",
  )
})
