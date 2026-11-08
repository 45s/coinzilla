import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { adaptSpotAsset } from "./adapt-spot-asset.js"

describe("adaptSpotAsset zero balances", () => {
  it("omits zero balances and retains a non-zero locked balance", () => {
    const result = adaptSpotAsset([
      { asset: "BTC", free: "0", locked: "0" },
      { asset: "ETH", free: "0", locked: "0.25" },
    ])
    assert.deepEqual(result, [{ ticker: "ETH", quantity: 0.25 }])
  })
})
