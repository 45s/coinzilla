import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Asset, assetErrMsgs } from "./asset.js"

describe(Asset.name, () => {
  it("normalizes the display code and preserves the canonical ID", () => {
    const asset = new Asset({ id: "  bitcoin  ", code: " btc " })

    assert.equal(asset.id, "bitcoin")
    assert.equal(asset.code, "BTC")
    assert.deepEqual(asset.value, { id: "bitcoin", code: "BTC" })
  })

  it("keeps distinct canonical assets distinct when their codes match", () => {
    const first = new Asset({ id: "token-one", code: "ABC" })
    const second = new Asset({ id: "token-two", code: "ABC" })

    assert.notEqual(first.id, second.id)
    assert.equal(first.code, second.code)
  })

  it("rejects missing, non-string, and blank IDs", () => {
    for (const id of [undefined, null, "", "  ", 1]) {
      assert.throws(() => new Asset({ id, code: "BTC" }), {
        message: assetErrMsgs.id,
      })
    }
  })

  it("rejects missing, non-string, and blank codes", () => {
    for (const code of [undefined, null, "", "  ", 1]) {
      assert.throws(() => new Asset({ id: "bitcoin", code }), {
        message: assetErrMsgs.code,
      })
    }
  })

  it("returns an independent value snapshot", () => {
    const asset = new Asset({ id: "bitcoin", code: "BTC" })
    const snapshot = asset.value

    snapshot.id = "ethereum"
    snapshot.code = "ETH"

    assert.deepEqual(asset.value, { id: "bitcoin", code: "BTC" })
    assert.notStrictEqual(asset.value, snapshot)
  })

  it("is immutable", () => {
    const asset = new Asset({ id: "bitcoin", code: "BTC" })

    assert.throws(() => {
      asset.id = "ethereum"
    }, TypeError)
  })
})
