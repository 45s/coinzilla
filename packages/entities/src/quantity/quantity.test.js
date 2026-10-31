import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Asset } from "../assets/asset.js"
import { Quantity, quantityErrMsgs } from "./quantity.js"

describe(Quantity.name, () => {
  const doge = new Asset({ id: "dogecoin", code: "DOGE" })

  it("stores an exact canonical non-negative amount with explicit asset identity", () => {
    const quantity = new Quantity({ amount: " 00100.000 ", asset: doge })

    assert.equal(quantity.amount, "100")
    assert.strictEqual(quantity.asset, doge)
    assert.deepEqual(quantity.value, {
      amount: "100",
      asset: { id: "dogecoin", code: "DOGE" },
    })
  })

  it("accepts zero and canonicalizes negative zero", () => {
    assert.equal(new Quantity({ amount: "0", asset: doge }).amount, "0")
    assert.equal(new Quantity({ amount: "-0.000", asset: doge }).amount, "0")
  })

  it("rejects negative quantities", () => {
    for (const amount of ["-0.0001", "-1"]) {
      assert.throws(
        () => new Quantity({ amount, asset: doge }),
        { message: "Quantity.amount must be non-negative" },
      )
    }
  })

  it("rejects missing or invalid Asset identity", () => {
    for (const asset of [undefined, null, "DOGE", { id: "dogecoin", code: "DOGE" }]) {
      assert.throws(
        () => new Quantity({ amount: "1", asset }),
        { message: quantityErrMsgs.asset },
      )
    }
  })

  it("rejects numbers, malformed strings, and unsupported precision", () => {
    for (const amount of [undefined, null, 1, 1.2, "", "1e2", "NaN", "1".repeat(257)]) {
      assert.throws(() => new Quantity({ amount, asset: doge }))
    }
  })

  it("returns an independent value snapshot", () => {
    const quantity = new Quantity({ amount: "100.25", asset: doge })
    const snapshot = quantity.value

    snapshot.amount = "999"
    snapshot.asset.code = "XXX"

    assert.deepEqual(quantity.value, {
      amount: "100.25",
      asset: { id: "dogecoin", code: "DOGE" },
    })
    assert.notStrictEqual(quantity.value, snapshot)
  })

  it("is immutable", () => {
    const quantity = new Quantity({ amount: "1", asset: doge })

    assert.throws(() => {
      quantity.amount = "2"
    }, TypeError)
  })
})
