import test from "node:test"
import assert from "node:assert/strict"
import { addDecimal } from "@coinzilla/utils"
import { reconcileJournalAccountSnapshotRecords } from "./account-snapshot-journal-utils.js"

const balance = ({ asset, free, locked = "0" }) => ({
  asset,
  free,
  locked,
  total: addDecimal({
    left: free,
    right: locked,
  }),
})

const event = ({
  phase,
  sourceTime,
  balances,
  auditStatus = "COMPLETE",
  auditReasons = [],
}) => ({
  name: "account.snapshot_captured",
  data: {
    phase,
    sourceTime,
    balances,
    auditStatus,
    auditReasons,
  },
})

const record = ({ fileName, payload }) => ({
  payload,
  position: {
    fileName,
    lineNumber: 1,
  },
})

const snapshotRecord = ({
  fileName,
  phase,
  sourceTime,
  balances,
  auditStatus,
  auditReasons,
}) => record({
  fileName,
  payload: event({
    phase,
    sourceTime,
    balances,
    auditStatus,
    auditReasons,
  }),
})

const multiSessionRecords = [
  snapshotRecord({
    fileName: "session-a.jsonl",
    phase: "PREFLIGHT",
    sourceTime: 100,
    balances: [
      balance({
        asset: "DOGE",
        free: "10.0001",
      }),
      balance({
        asset: "USDT",
        free: "20",
      }),
    ],
  }),
  record({
    fileName: "session-a.jsonl",
    payload: {
      name: "bot.started",
      data: {},
    },
  }),
  record({
    fileName: "session-a.jsonl",
    payload: {
      name: "recovery.cycle_completed",
      data: { realizedNetProfit: "0.07808" },
    },
  }),
  record({
    fileName: "session-a.jsonl",
    payload: {
      name: "recovery.cycle_completed",
      data: { realizedNetProfit: "0.03285" },
    },
  }),
  snapshotRecord({
    fileName: "session-a.jsonl",
    phase: "CLOSING",
    sourceTime: 200,
    balances: [
      balance({
        asset: "DOGE",
        free: "10.1251",
      }),
      balance({
        asset: "USDT",
        free: "19.5",
      }),
    ],
  }),
  snapshotRecord({
    fileName: "session-b.jsonl",
    phase: "PREFLIGHT",
    sourceTime: 300,
    balances: [balance({
        asset: "ZRO",
        free: "2",
      })],
  }),
  record({
    fileName: "session-b.jsonl",
    payload: {
      name: "recovery.cycle_completed",
      data: { realizedNetProfit: "0.36335" },
    },
  }),
  snapshotRecord({
    fileName: "session-b.jsonl",
    phase: "CLOSING",
    sourceTime: 400,
    balances: [balance({
        asset: "ZRO",
        free: "2.1",
      })],
  }),
]

test("pairs snapshots by Journal session and computes exact asset deltas", () => {
  const result = reconcileJournalAccountSnapshotRecords({
    records: multiSessionRecords,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.sessionCount, 2)
  assert.deepEqual(result.data.reports[0].assetDeltas[0].delta.total, "0.125")
  assert.equal(result.data.reports[0].recoveryCycleCount, 2)
  assert.equal(result.data.reports[0].cumulativeRecoveryNetProfit, "0.11093")
  assert.equal(result.data.reports[1].assetDeltas[0].delta.total, "0.1")
  assert.equal(result.data.reports[1].cumulativeRecoveryNetProfit, "0.36335")
  assert.equal(result.data.profitAssessment, "NOT_DETERMINABLE_FROM_BALANCE_DELTAS_ALONE")
})

test("pairs current PREFLIGHT/CLOSING snapshots by Journal session", () => {
  const result = reconcileJournalAccountSnapshotRecords({
    records: [
      snapshotRecord({
        fileName: "preflight-session.jsonl",
        phase: "PREFLIGHT",
        sourceTime: 100,
        balances: [
          balance({
        asset: "DOGE",
        free: "10",
      }),
          balance({
        asset: "USDT",
        free: "20",
      }),
        ],
      }),
      snapshotRecord({
        fileName: "preflight-session.jsonl",
        phase: "CLOSING",
        sourceTime: 200,
        balances: [
          balance({
        asset: "DOGE",
        free: "10.25",
      }),
          balance({
        asset: "USDT",
        free: "19.5",
      }),
        ],
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.reports[0].auditStatus, "COMPLETE")
  assert.deepEqual(result.data.reports[0].assetDeltas[0].delta.total, "0.25")
  assert.deepEqual(result.data.reports[0].assetDeltas[1].delta.total, "-0.5")
})

test("continues to read legacy OPENING snapshots from historical Journal sessions", () => {
  const result = reconcileJournalAccountSnapshotRecords({
    records: [
      snapshotRecord({
        fileName: "legacy-session.jsonl",
        phase: "OPENING",
        sourceTime: 100,
        balances: [balance({
        asset: "DOGE",
        free: "2",
      })],
      }),
      snapshotRecord({
        fileName: "legacy-session.jsonl",
        phase: "CLOSING",
        sourceTime: 200,
        balances: [balance({
        asset: "DOGE",
        free: "3",
      })],
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.reports[0].assetDeltas[0].delta.total, "1")
})

test("reports missing or duplicate snapshot endpoints as incomplete instead of inventing deltas", () => {
  const result = reconcileJournalAccountSnapshotRecords({
    records: [
      snapshotRecord({
        fileName: "missing-close.jsonl",
        phase: "PREFLIGHT",
        sourceTime: 100,
        balances: [],
      }),
      snapshotRecord({
        fileName: "duplicate-open.jsonl",
        phase: "PREFLIGHT",
        sourceTime: 100,
        balances: [],
      }),
      snapshotRecord({
        fileName: "duplicate-open.jsonl",
        phase: "PREFLIGHT",
        sourceTime: 101,
        balances: [],
      }),
      snapshotRecord({
        fileName: "duplicate-open.jsonl",
        phase: "CLOSING",
        sourceTime: 200,
        balances: [],
      }),
    ],
  })

  assert.equal(result.ok, false)
  const reports = new Map(result.data.reports.map((report) => [report.session, report]))
  assert.equal(reports.get("missing-close.jsonl").auditStatus, "INCOMPLETE")
  assert.deepEqual(reports.get("missing-close.jsonl").blockers, ["CLOSING_SNAPSHOT_COUNT:0"])
  assert.deepEqual(reports.get("duplicate-open.jsonl").blockers, ["PREFLIGHT_SNAPSHOT_COUNT:2"])
})

test("reports duplicate CLOSING endpoints as an incomplete session", () => {
  const result = reconcileJournalAccountSnapshotRecords({
    records: [
      snapshotRecord({
        fileName: "duplicate-close.jsonl",
        phase: "PREFLIGHT",
        sourceTime: 100,
        balances: [],
      }),
      snapshotRecord({
        fileName: "duplicate-close.jsonl",
        phase: "CLOSING",
        sourceTime: 200,
        balances: [],
      }),
      snapshotRecord({
        fileName: "duplicate-close.jsonl",
        phase: "CLOSING",
        sourceTime: 201,
        balances: [],
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.equal(result.data.reports[0].auditStatus, "INCOMPLETE")
  assert.deepEqual(result.data.reports[0].blockers, ["CLOSING_SNAPSHOT_COUNT:2"])
  assert.deepEqual(result.data.reports[0].assetDeltas, [])
})

test("fails closed for malformed snapshot session, phase, and recovery profit records", () => {
  const missingSession = reconcileJournalAccountSnapshotRecords({
    records: [{
      payload: event({
        phase: "PREFLIGHT",
        sourceTime: 100,
        balances: [],
      }),
      position: { lineNumber: 1 },
    }],
  })
  const invalidPhase = reconcileJournalAccountSnapshotRecords({
    records: [
      snapshotRecord({
        fileName: "invalid-phase.jsonl",
        phase: "MIDDLE",
        sourceTime: 100,
        balances: [],
      }),
    ],
  })
  const malformedProfit = reconcileJournalAccountSnapshotRecords({
    records: [
      record({
        fileName: "malformed-profit.jsonl",
        payload: {
          name: "recovery.cycle_completed",
          data: { realizedNetProfit: "NaN" },
        },
      }),
    ],
  })

  assert.equal(missingSession.ok, false)
  assert.equal(invalidPhase.ok, false)
  assert.equal(malformedProfit.ok, false)
})

test("preserves an INCOMPLETE closing audit and rejects missing snapshot events", () => {
  const incomplete = reconcileJournalAccountSnapshotRecords({
    records: [
      snapshotRecord({
        fileName: "incomplete.jsonl",
        phase: "PREFLIGHT",
        sourceTime: 100,
        balances: [],
      }),
      snapshotRecord({
        fileName: "incomplete.jsonl",
        phase: "CLOSING",
        sourceTime: 200,
        balances: [],
        auditStatus: "INCOMPLETE",
        auditReasons: ["UNRESOLVED_OWNED_ORDERS:1"],
      }),
    ],
  })

  assert.equal(incomplete.ok, false)
  assert.equal(incomplete.data.reports[0].auditStatus, "INCOMPLETE")
  assert.deepEqual(incomplete.data.reports[0].auditReasons, ["CLOSING:UNRESOLVED_OWNED_ORDERS:1"])
  assert.equal(reconcileJournalAccountSnapshotRecords({ records: [] }).ok, false)
})
