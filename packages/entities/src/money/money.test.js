import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Asset } from "../assets/asset.js"
import { Money, moneyErrMsgs } from "./money.js"

describe(Money.name, () => {
  const usd = new Asset({ id: "usd", code: "USD" })

  it("stores an exact canonical amount with explicit asset identity", () => {
    const money = new Money({ amount: " 00012.3400 ", asset: usd })

    assert.equal(money.amount, "12.34")
    assert.strictEqual(money.asset, usd)
    assert.deepEqual(money.value, {
      amount: "12.34",
      asset: { id: "usd", code: "USD" },
    })
  })

  it("supports negative values without floating-point conversion", () => {
    const money = new Money({
      amount: "-12345678901234567890.000000000000000001",
      asset: usd,
    })

    assert.equal(money.amount, "-12345678901234567890.000000000000000001")
  })

  it("rejects missing or invalid Asset identity", () => {
    for (const asset of [undefined, null, "USD", { id: "usd", code: "USD" }]) {
      assert.throws(
        () => new Money({ amount: "1", asset }),
        { message: moneyErrMsgs.asset },
      )
    }
  })

  it("rejects numbers, malformed strings, and unsupported precision", () => {
    for (const amount of [undefined, null, 1, 1.2, "", "1e2", "NaN", "1".repeat(257)]) {
      assert.throws(() => new Money({ amount, asset: usd }))
    }
  })

  it("returns an independent value snapshot", () => {
    const money = new Money({ amount: "1.25", asset: usd })
    const snapshot = money.value

    snapshot.amount = "999"
    snapshot.asset.code = "XXX"

    assert.deepEqual(money.value, {
      amount: "1.25",
      asset: { id: "usd", code: "USD" },
    })
    assert.notStrictEqual(money.value, snapshot)
  })

  it("is immutable", () => {
    const money = new Money({ amount: "1", asset: usd })

    assert.throws(() => {
      money.amount = "2"
    }, TypeError)
  })
})
