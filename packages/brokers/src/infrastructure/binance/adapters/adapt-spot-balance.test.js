import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Asset, Balance, Quantity } from "@coinzilla/entities"
import { adaptSpotBalance } from "./adapt-spot-balance.js"

describe("adaptSpotBalance", () => {
  it("preserves exact free and locked decimal strings as canonical balances", () => {
    const [balance] = adaptSpotBalance([
      {
        asset: "BTC",
        free: "0.200000000000000001",
        locked: "0.050000000000000009",
      },
    ])

    assert.ok(balance instanceof Balance)
    assert.ok(balance.asset instanceof Asset)
    assert.equal(balance.asset.id, "btc")
    assert.equal(balance.asset.code, "BTC")
    assert.equal(balance.free.amount, "0.200000000000000001")
    assert.equal(balance.locked.amount, "0.050000000000000009")
    assert.equal(balance.total.amount, "0.25000000000000001")
    assert.strictEqual(balance.free.asset, balance.asset)
    assert.strictEqual(balance.locked.asset, balance.asset)
  })

  it("preserves zero balances instead of silently omitting them", () => {
    const [balance] = adaptSpotBalance([
      { asset: "USDT", free: "0", locked: "0" },
    ])

    assert.ok(balance instanceof Balance)
    assert.equal(balance.free.amount, "0")
    assert.equal(balance.locked.amount, "0")
    assert.equal(balance.total.amount, "0")
  })

  it("keeps prefixed asset codes distinct instead of rewriting identity", () => {
    const [balance] = adaptSpotBalance([
      { asset: "LDUSDT", free: "1", locked: "0" },
    ])

    assert.equal(balance.asset.id, "ldusdt")
    assert.equal(balance.asset.code, "LDUSDT")
  })

  it("normalizes asset code case without changing identity semantics", () => {
    const [balance] = adaptSpotBalance([
      { asset: "btc", free: "1", locked: "0" },
    ])

    assert.equal(balance.asset.id, "btc")
    assert.equal(balance.asset.code, "BTC")
  })

  it("rejects malformed balance collections and entries", () => {
    for (const input of [undefined, null, {}, "balances"]) {
      assert.throws(() => adaptSpotBalance(input), /balances should be an array/)
    }
    for (const input of [[null], [[]], [1]]) {
      assert.throws(() => adaptSpotBalance(input), /balance should be an object/)
    }
  })

  it("rejects missing asset codes and invalid quantities", () => {
    for (const balance of [
      { free: "1", locked: "0" },
      { asset: "", free: "1", locked: "0" },
      { asset: "BTC", free: "invalid", locked: "0" },
      { asset: "BTC", free: "1", locked: "-1" },
      { asset: "BTC", free: "1" },
    ]) {
      assert.throws(() => adaptSpotBalance([balance]))
    }
  })

  it("does not convert balances through JavaScript Number", () => {
    const [balance] = adaptSpotBalance([
      {
        asset: "BTC",
        free: "9007199254740993.00000001",
        locked: "0.00000002",
      },
    ])

    assert.equal(balance.total.amount, "9007199254740993.00000003")
    assert.ok(balance.free instanceof Quantity)
  })
})
