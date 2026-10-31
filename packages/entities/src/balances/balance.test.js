import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Asset } from "../assets/asset.js"
import { Quantity } from "../quantity/quantity.js"
import { Balance, balanceErrMsgs } from "./balance.js"

describe(Balance.name, () => {
  const btc = new Asset({ id: "bitcoin", code: "BTC" })
  const otherBtc = new Asset({ id: "wrapped-bitcoin", code: "BTC" })

  const quantity = (amount, asset = btc) => new Quantity({ amount, asset })

  it("stores exact free and locked quantities and derives total", () => {
    const balance = new Balance({
      free: quantity("1.25"),
      locked: quantity("0.75"),
    })

    assert.strictEqual(balance.asset, btc)
    assert.equal(balance.free.amount, "1.25")
    assert.equal(balance.locked.amount, "0.75")
    assert.equal(balance.total.amount, "2")
    assert.strictEqual(balance.total.asset, btc)
    assert.deepEqual(balance.value, {
      asset: { id: "bitcoin", code: "BTC" },
      free: { amount: "1.25", asset: { id: "bitcoin", code: "BTC" } },
      locked: { amount: "0.75", asset: { id: "bitcoin", code: "BTC" } },
      total: { amount: "2", asset: { id: "bitcoin", code: "BTC" } },
    })
  })

  it("adds decimal quantities exactly without floating-point conversion", () => {
    const balance = new Balance({
      free: quantity("12345678901234567890.000000000000000001"),
      locked: quantity("0.000000000000000009"),
    })

    assert.equal(balance.total.amount, "12345678901234567890.00000000000000001")
  })

  it("supports zero free and locked quantities", () => {
    const balance = new Balance({
      free: quantity("0"),
      locked: quantity("0.000"),
    })

    assert.equal(balance.total.amount, "0")
  })

  it("rejects missing or invalid free quantities", () => {
    for (const free of [undefined, null, "1", { amount: "1", asset: btc }]) {
      assert.throws(() => new Balance({ free, locked: quantity("0") }), {
        message: balanceErrMsgs.free,
      })
    }
  })

  it("rejects missing or invalid locked quantities", () => {
    for (const locked of [undefined, null, "1", { amount: "1", asset: btc }]) {
      assert.throws(() => new Balance({ free: quantity("0"), locked }), {
        message: balanceErrMsgs.locked,
      })
    }
  })

  it("rejects quantities belonging to different canonical assets even when codes match", () => {
    assert.throws(
      () => new Balance({
        free: quantity("1", btc),
        locked: quantity("1", otherBtc),
      }),
      { message: balanceErrMsgs.asset },
    )
  })

  it("returns independent snapshots", () => {
    const balance = new Balance({
      free: quantity("1"),
      locked: quantity("2"),
    })
    const snapshot = balance.value

    snapshot.asset.code = "XXX"
    snapshot.free.amount = "999"
    snapshot.free.asset.id = "other"
    snapshot.locked.amount = "999"
    snapshot.total.amount = "999"

    assert.deepEqual(balance.value, {
      asset: { id: "bitcoin", code: "BTC" },
      free: { amount: "1", asset: { id: "bitcoin", code: "BTC" } },
      locked: { amount: "2", asset: { id: "bitcoin", code: "BTC" } },
      total: { amount: "3", asset: { id: "bitcoin", code: "BTC" } },
    })
  })

  it("is immutable", () => {
    const balance = new Balance({
      free: quantity("1"),
      locked: quantity("2"),
    })

    assert.throws(() => {
      balance.free = quantity("3")
    }, TypeError)
  })
})
