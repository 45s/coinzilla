import test from "node:test"
import assert from "node:assert/strict"
import { mapAccountSnapshotCapturedData } from "../src/application/events/lifecycle-event-dtos.js"

const makeBalance = ({ code, free = "0", locked = "0" }) => ({
  asset: { code },
  free: { amount: free },
  locked: { amount: locked },
})

test("account snapshot Journal DTO stores only configured assets once", () => {
  const snapshot = {
    sourceTime: 123,
    balances: [
      makeBalance({ code: "DOGE", free: "12" }),
      makeBalance({ code: "USDT", free: "30" }),
      makeBalance({ code: "ZRO", free: "4" }),
      makeBalance({ code: "BTC", free: "0.2" }),
    ],
  }

  const result = mapAccountSnapshotCapturedData({
    phase: "PREFLIGHT",
    snapshot,
    allowedAssetCodes: ["DOGE", "USDT", "ZRO", "USDT"],
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.balances.map(({ asset }) => asset), ["DOGE", "USDT", "ZRO"])
  assert.equal(result.data.assetCount, 3)
  assert.equal(result.data.sourceTime, 123)
  assert.equal(snapshot.balances.length, 4)
})

test("account snapshot Journal DTO rejects a missing configured asset", () => {
  const result = mapAccountSnapshotCapturedData({
    phase: "CLOSING",
    snapshot: { sourceTime: 123, balances: [makeBalance({ code: "DOGE" })] },
    allowedAssetCodes: ["DOGE", "USDT"],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /missing configured assets: USDT/)
})

test("account snapshot Journal DTO retains zero balances for configured assets", () => {
  const result = mapAccountSnapshotCapturedData({
    phase: "OPENING",
    snapshot: { sourceTime: 123, balances: [makeBalance({ code: "DOGE" }), makeBalance({ code: "USDT" })] },
    allowedAssetCodes: ["DOGE", "USDT"],
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.balances.map(({ asset, total }) => ({ asset, total })), [
    { asset: "DOGE", total: "0" },
    { asset: "USDT", total: "0" },
  ])
})
