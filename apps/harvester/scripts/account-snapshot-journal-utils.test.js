import test from "node:test"
import assert from "node:assert/strict"
import { addDecimal } from "@coinzilla/utils"
import { reconcileJournalAccountSnapshotRecords } from "./account-snapshot-journal-utils.js"

const balance = (asset, free, locked = "0") => ({
  asset, free, locked, total: addDecimal({ left: free, right: locked }),
})
const event = (phase, sourceTime, balances, auditStatus = "COMPLETE", auditReasons = []) => ({
  name: "account.snapshot_captured",
  data: { phase, sourceTime, balances, auditStatus, auditReasons },
})
const record = (fileName, payload) => ({ payload, position: { fileName, lineNumber: 1 } })

test("pairs snapshots by Journal session and computes exact asset deltas", () => {
  const result = reconcileJournalAccountSnapshotRecords({
    records: [
      record("session-a.jsonl", event("OPENING", 100, [balance("DOGE", "10.0001"), balance("USDT", "20")])),
      record("session-a.jsonl", { name: "bot.started", data: {} }),
      record("session-a.jsonl", event("CLOSING", 200, [balance("DOGE", "10.1251"), balance("USDT", "19.5")])),
      record("session-b.jsonl", event("OPENING", 300, [balance("ZRO", "2")])),
      record("session-b.jsonl", event("CLOSING", 400, [balance("ZRO", "2.1")])),
    ],
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.sessionCount, 2)
  assert.deepEqual(result.data.reports[0].assetDeltas[0].delta.total, "0.125")
  assert.equal(result.data.reports[1].assetDeltas[0].delta.total, "0.1")
  assert.equal(result.data.profitAssessment, "NOT_DETERMINABLE_FROM_BALANCE_DELTAS_ALONE")
})

test("reports missing or duplicate snapshot endpoints as incomplete instead of inventing deltas", () => {
  const result = reconcileJournalAccountSnapshotRecords({
    records: [
      record("missing-close.jsonl", event("OPENING", 100, [])),
      record("duplicate-open.jsonl", event("OPENING", 100, [])),
      record("duplicate-open.jsonl", event("OPENING", 101, [])),
      record("duplicate-open.jsonl", event("CLOSING", 200, [])),
    ],
  })
  assert.equal(result.ok, false)
  assert.equal(result.data.reports[0].auditStatus, "INCOMPLETE")
  assert.deepEqual(result.data.reports[0].blockers, ["CLOSING_SNAPSHOT_COUNT:0"])
  assert.deepEqual(result.data.reports[1].blockers, ["OPENING_SNAPSHOT_COUNT:2"])
})

test("preserves an INCOMPLETE closing audit and rejects missing snapshot events", () => {
  const incomplete = reconcileJournalAccountSnapshotRecords({
    records: [
      record("incomplete.jsonl", event("OPENING", 100, [])),
      record("incomplete.jsonl", event("CLOSING", 200, [], "INCOMPLETE", ["UNRESOLVED_OWNED_ORDERS:1"])),
    ],
  })
  assert.equal(incomplete.ok, false)
  assert.equal(incomplete.data.reports[0].auditStatus, "INCOMPLETE")
  assert.deepEqual(incomplete.data.reports[0].auditReasons, ["CLOSING:UNRESOLVED_OWNED_ORDERS:1"])
  assert.equal(reconcileJournalAccountSnapshotRecords({ records: [] }).ok, false)
})
