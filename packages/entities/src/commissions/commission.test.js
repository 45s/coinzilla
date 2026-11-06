import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Asset } from "../assets/asset.js"
import { Money } from "../money/money.js"
import { Commission, commissionErrMsgs } from "./commission.js"

describe(Commission.name, () => {
  const asset = new Asset({ id: "bnb", code: "BNB" })
  const createCommission = (overrides = {}) =>
    new Commission({
      amount: new Money({ amount: "0.01", asset }),
      ...overrides,
    })

  it("stores an exact Money amount with explicit asset identity", () => {
    const commission = createCommission()

    assert.equal(commission.amount.amount, "0.01")
    assert.equal(commission.amount.asset.id, "bnb")
    assert.deepEqual(commission.value, {
      amount: {
        amount: "0.01",
        asset: asset.value,
      },
    })
  })

  it("accepts a zero amount", () => {
    const commission = createCommission({
      amount: new Money({ amount: "0", asset }),
    })

    assert.equal(commission.amount.amount, "0")
  })

  it("rejects non-Money amounts", () => {
    assert.throws(
      () => createCommission({ amount: "0.01" }),
      { message: commissionErrMsgs.amount },
    )
  })

  it("rejects negative amounts", () => {
    assert.throws(
      () => createCommission({
        amount: new Money({ amount: "-0.01", asset }),
      }),
      { message: commissionErrMsgs.nonNegativeAmount },
    )
  })

  it("returns independent snapshots and is immutable", () => {
    const commission = createCommission()
    const snapshot = commission.value

    snapshot.amount.amount = "99"

    assert.equal(commission.amount.amount, "0.01")
    assert.notStrictEqual(commission.value, snapshot)
    assert.throws(() => {
      commission.amount = new Money({ amount: "1", asset })
    }, TypeError)
  })
})
