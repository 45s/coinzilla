import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { adaptSpotAsset } from "./adapt-spot-asset.js"

describe("adaptSpotAsset earn assets", () => {
  it("strips the LD prefix and combines free and locked amounts", () => {
    assert.deepEqual(adaptSpotAsset([
      { asset: "LDBTC", free: "0.1", locked: "0.02" },
      { asset: "LDUSDT", free: "0", locked: "0" },
    ]), [{ ticker: "BTC", quantity: 0.12000000000000001 }])
  })
})
