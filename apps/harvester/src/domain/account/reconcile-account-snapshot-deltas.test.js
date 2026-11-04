import test from "node:test"
import assert from "node:assert/strict"
import { addDecimal } from "@coinzilla/utils"
import { reconcileAccountSnapshotDeltas } from "./reconcile-account-snapshot-deltas.js"

const snapshot = ({ phase, sourceTime, balances, auditStatus = "COMPLETE", auditReasons = [] }) => ({
  phase, sourceTime, balances, auditStatus, auditReasons,
})
const balance = (asset, free, locked = "0") => ({
  asset, free, locked, total: addDecimal({ left: free, right: locked }),
})

test("reconciles exact per-asset wallet deltas and assets appearing/disappearing", () => {
  const result = reconcileAccountSnapshotDeltas({
    openingSnapshot: snapshot({
      phase: "OPENING", sourceTime: 100,
      balances: [balance("DOGE", "100"), balance("USDT", "10", "2"), balance("FDUSD", "5")],
    }),
    closingSnapshot: snapshot({
      phase: "CLOSING", sourceTime: 200,
      balances: [balance("DOGE", "101.25"), balance("USDT", "8.5", "1"), balance("BNB", "0.01")],
    }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.auditStatus, "COMPLETE")
  assert.deepEqual(result.data.assetDeltas, [
    { asset: "BNB", opening: { free: "0", locked: "0", total: "0" }, closing: { free: "0.01", locked: "0", total: "0.01" }, delta: { free: "0.01", locked: "0", total: "0.01" } },
    { asset: "DOGE", opening: { free: "100", locked: "0", total: "100" }, closing: { free: "101.25", locked: "0", total: "101.25" }, delta: { free: "1.25", locked: "0", total: "1.25" } },
    { asset: "FDUSD", opening: { free: "5", locked: "0", total: "5" }, closing: { free: "0", locked: "0", total: "0" }, delta: { free: "-5", locked: "0", total: "-5" } },
    { asset: "USDT", opening: { free: "10", locked: "2", total: "12" }, closing: { free: "8.5", locked: "1", total: "9.5" }, delta: { free: "-1.5", locked: "-1", total: "-2.5" } },
  ])
  assert.equal(result.data.profitAssessment, "NOT_DETERMINABLE_FROM_BALANCE_DELTAS_ALONE")
})

test("propagates incomplete closing audit status and reasons", () => {
  const result = reconcileAccountSnapshotDeltas({
    openingSnapshot: snapshot({ phase: "OPENING", sourceTime: 100, balances: [] }),
    closingSnapshot: snapshot({
      phase: "CLOSING", sourceTime: 200, balances: [],
      auditStatus: "INCOMPLETE", auditReasons: ["UNRESOLVED_OWNED_ORDERS:1"],
    }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.auditStatus, "INCOMPLETE")
  assert.deepEqual(result.data.auditReasons, ["CLOSING:UNRESOLVED_OWNED_ORDERS:1"])
})

test("rejects inconsistent, negative, duplicate, or out-of-order snapshots", () => {
  const opening = snapshot({ phase: "OPENING", sourceTime: 100, balances: [balance("USDT", "1")] })
  assert.equal(reconcileAccountSnapshotDeltas({
    openingSnapshot: opening,
    closingSnapshot: snapshot({ phase: "CLOSING", sourceTime: 99, balances: [] }),
  }).ok, false)
  assert.equal(reconcileAccountSnapshotDeltas({
    openingSnapshot: opening,
    closingSnapshot: snapshot({ phase: "CLOSING", sourceTime: 200, balances: [{ asset: "USDT", free: "1", locked: "1", total: "1" }] }),
  }).ok, false)
  assert.equal(reconcileAccountSnapshotDeltas({
    openingSnapshot: opening,
    closingSnapshot: snapshot({ phase: "CLOSING", sourceTime: 200, balances: [balance("USDT", "-1")] }),
  }).ok, false)
  assert.equal(reconcileAccountSnapshotDeltas({
    openingSnapshot: opening,
    closingSnapshot: snapshot({ phase: "CLOSING", sourceTime: 200, balances: [balance("USDT", "1"), balance("USDT", "2")] }),
  }).ok, false)
})
