import test from "node:test"
import assert from "node:assert/strict"
import { reconcileAccountSnapshotDeltas } from "./reconcile-account-snapshot-deltas.js"

const snapshot = ({ phase, sourceTime, balances, auditStatus = "COMPLETE", auditReasons = [] }) => ({
  phase, sourceTime, balances, auditStatus, auditReasons,
})
const balance = (asset, free, locked, total) => ({
  asset, free, locked, total,
})
const copySnapshot = (value) => ({
  ...value,
  balances: value.balances.map((item) => ({ ...item })),
  auditReasons: [...value.auditReasons],
})

test("reconciles current PREFLIGHT/CLOSING snapshots", () => {
  const result = reconcileAccountSnapshotDeltas({
    openingSnapshot: snapshot({
      phase: "PREFLIGHT",
      sourceTime: 100,
      balances: [balance("DOGE", "10", "0", "10")],
    }),
    closingSnapshot: snapshot({
      phase: "CLOSING",
      sourceTime: 200,
      balances: [balance("DOGE", "11", "0", "11")],
    }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.auditStatus, "COMPLETE")
  assert.equal(result.data.assetDeltas[0].delta.total, "1")
  assert.deepEqual(result.data.auditReasons, [])
})

test("reconciles exact per-asset wallet deltas and assets appearing/disappearing", () => {
  const result = reconcileAccountSnapshotDeltas({
    openingSnapshot: snapshot({
      phase: "OPENING", sourceTime: 100,
      balances: [balance("DOGE", "100", "0", "100"), balance("USDT", "10", "2", "12"), balance("FDUSD", "5", "0", "5")],
    }),
    closingSnapshot: snapshot({
      phase: "CLOSING", sourceTime: 200,
      balances: [balance("DOGE", "101.25", "0", "101.25"), balance("USDT", "8.5", "1", "9.5"), balance("BNB", "0.01", "0", "0.01")],
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

test("returns the exact failure and leaves both snapshots unchanged for invalid reconciliation inputs", () => {
  const openingSnapshot = snapshot({
    phase: "OPENING",
    sourceTime: 100,
    balances: [balance("USDT", "1", "0", "1")],
  })
  const cases = [
    {
      name: "closing snapshot predates opening snapshot",
      closingSnapshot: snapshot({ phase: "CLOSING", sourceTime: 99, balances: [] }),
      expectedError: "CLOSING account snapshot predates the PREFLIGHT/OPENING baseline",
    },
    {
      name: "closing balance total is inconsistent",
      closingSnapshot: snapshot({
        phase: "CLOSING",
        sourceTime: 200,
        balances: [{ asset: "USDT", free: "1", locked: "1", total: "1" }],
      }),
      expectedError: "CLOSING snapshot total does not equal free plus locked for USDT",
    },
    {
      name: "closing balance is negative",
      closingSnapshot: snapshot({
        phase: "CLOSING",
        sourceTime: 200,
        balances: [balance("USDT", "-1", "0", "-1")],
      }),
      expectedError: "CLOSING snapshot balance cannot be negative: USDT.free",
    },
    {
      name: "closing snapshot contains a duplicate asset",
      closingSnapshot: snapshot({
        phase: "CLOSING",
        sourceTime: 200,
        balances: [balance("USDT", "1", "0", "1"), balance("USDT", "2", "0", "2")],
      }),
      expectedError: "CLOSING snapshot contains duplicate asset USDT",
    },
  ]

  for (const scenario of cases) {
    const openingBefore = copySnapshot(openingSnapshot)
    const closingBefore = copySnapshot(scenario.closingSnapshot)
    const result = reconcileAccountSnapshotDeltas({
      openingSnapshot,
      closingSnapshot: scenario.closingSnapshot,
    })

    assert.equal(
      result.ok,
      false,
      "The " + scenario.name + " case must return a structured reconciliation failure.",
    )
    assert.equal(
      result.data,
      undefined,
      "The " + scenario.name + " case must not expose a partial reconciliation result.",
    )
    assert.deepEqual(
      result.errors.map((error) => error.message),
      [scenario.expectedError],
      "The " + scenario.name + " case must report its precise domain validation failure.",
    )
    assert.deepEqual(
      openingSnapshot,
      openingBefore,
      "Rejecting the " + scenario.name + " case must not mutate the accepted opening snapshot.",
    )
    assert.deepEqual(
      scenario.closingSnapshot,
      closingBefore,
      "Rejecting the " + scenario.name + " case must not mutate the invalid closing snapshot.",
    )
  }
})
