import assert from "node:assert/strict"
import test from "node:test"
import { Balance } from "@coinzilla/entities"
import { adaptBalances } from "./adapt-balances.js"

test("adapts Bitunix Spot account rows to exact canonical balances", () => {
  const balances = adaptBalances([
    { coin: "BTC",
      balance: "0.01000000",
      balanceLocked: "0.00200000" },
    { coin: "USDT",
      balance: "125.50",
      balanceLocked: "0" },
  ])

  assert.equal(balances.length, 2)
  assert.ok(balances[0] instanceof Balance)
  assert.equal(balances[0].free.amount, "0.01")
  assert.equal(balances[0].locked.amount, "0.002")
  assert.equal(balances[0].free.asset.code, "BTC")
  assert.equal(balances[1].free.amount, "125.5")
})

test("rejects malformed, imprecise, negative and duplicate Bitunix balance rows", () => {
  assert.throws(() => adaptBalances({}))
  assert.throws(() => adaptBalances([{ coin: "BTC",
    balance: "1" }]))
  assert.throws(() => adaptBalances([
    { coin: "BTC",
      balance: 0.1,
      balanceLocked: "0" },
  ]), /precision-preserving/i)
  assert.throws(() => adaptBalances([
    { coin: "BTC",
      balance: "-1",
      balanceLocked: "0" },
  ]), /non-negative/i)
  assert.throws(() => adaptBalances([
    { coin: "BTC",
      balance: "1",
      balanceLocked: "0" },
    { coin: "btc",
      balance: "2",
      balanceLocked: "0" },
  ]))
})
