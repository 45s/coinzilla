import assert from "node:assert/strict"
import test from "node:test"
import {
  resolveSessionChronology,
  validateAndOrderSessions,
} from "./resolve-session-chronology.js"

const SESSION_STARTED_AT = "2026-11-17T00:00:00.000Z"
const SESSION_DIRECTORY = "/tmp/2026-11-17_00-00-00-session-a"

function processStartedRecord({
  startedAt = SESSION_STARTED_AT,
  eventTimestamp = "2026-11-17T00:00:00.010Z",
  runtimeSessionId = "session-a",
  processId = 1234,
} = {}) {
  return {
    payload: {
      name: "harvester.process_started",
      source: "harvester",
      timestamp: eventTimestamp,
      data: { startedAt, runtimeSessionId, processId },
    },
  }
}

function markerRecord(timestamp) {
  return {
    payload: {
      name: "harvester.marker",
      timestamp,
    },
  }
}

test("uses validated process-start metadata as session chronology evidence", () => {
  const chronology = resolveSessionChronology({
    records: [
      processStartedRecord(),
      markerRecord("2026-11-17T00:00:00.020Z"),
    ],
    directory: SESSION_DIRECTORY,
  })

  assert.equal(
    chronology.chronologySource,
    "PROCESS_STARTED",
    "A valid process-start event must be the authoritative chronology source for its session.",
  )
  assert.equal(
    chronology.runtimeSessionId,
    "session-a",
    "The chronology result must preserve the process identity used to validate the session directory.",
  )
  assert.equal(
    chronology.lastRecordTimestamp,
    Date.parse("2026-11-17T00:00:00.020Z"),
    "The last event timestamp must exclude no later ordinary event from the session range.",
  )
})

test("rejects process-start metadata that conflicts with its session directory", () => {
  assert.throws(
    () => resolveSessionChronology({
      records: [processStartedRecord({ runtimeSessionId: "different-session" })],
      directory: SESSION_DIRECTORY,
    }),
    (error) => error.code === "HARVESTER_JOURNAL_PROCESS_IDENTITY_MISMATCH",
    "A process identity that disagrees with the directory name must not be trusted for chronology.",
  )
})

test("marks non-monotonic legacy event timestamps as unavailable chronology", () => {
  const chronology = resolveSessionChronology({
    records: [
      markerRecord("2026-11-17T00:00:00.020Z"),
      markerRecord("2026-11-17T00:00:00.010Z"),
    ],
    directory: "/tmp/legacy-session.jsonl",
  })

  assert.equal(
    chronology.chronologySource,
    "UNAVAILABLE",
    "A session with non-monotonic event timestamps must not claim a safe chronological position.",
  )
})

test("orders sessions only when chronology is unique and event ranges do not overlap", () => {
  const earlierSession = {
    fileName: "earlier.jsonl",
    chronologySource: "FIRST_RECORD_TIMESTAMP",
    chronologyTimestamp: 100,
    lastRecordTimestamp: 150,
    runtimeSessionId: null,
  }
  const laterSession = {
    fileName: "later.jsonl",
    chronologySource: "PROCESS_STARTED",
    chronologyTimestamp: 200,
    lastRecordTimestamp: 250,
    runtimeSessionId: "later-run",
  }
  const ordered = validateAndOrderSessions([laterSession, earlierSession])

  assert.deepEqual(
    ordered.map((session) => session.fileName),
    ["earlier.jsonl", "later.jsonl"],
    "Sessions must be ordered by evidence timestamps rather than filesystem enumeration order.",
  )
})

test("rejects tied chronology evidence and overlapping session event ranges", () => {
  assert.throws(
    () => validateAndOrderSessions([
      {
        fileName: "first.jsonl",
        chronologySource: "FIRST_RECORD_TIMESTAMP",
        chronologyTimestamp: 100,
        lastRecordTimestamp: 150,
        runtimeSessionId: null,
      },
      {
        fileName: "second.jsonl",
        chronologySource: "FIRST_RECORD_TIMESTAMP",
        chronologyTimestamp: 100,
        lastRecordTimestamp: 175,
        runtimeSessionId: null,
      },
    ]),
    (error) => error.code === "HARVESTER_JOURNAL_SESSION_ORDER_AMBIGUOUS",
    "Equal chronology timestamps must fail closed instead of using arbitrary directory order.",
  )

  assert.throws(
    () => validateAndOrderSessions([
      {
        fileName: "first.jsonl",
        chronologySource: "FIRST_RECORD_TIMESTAMP",
        chronologyTimestamp: 100,
        lastRecordTimestamp: 225,
        runtimeSessionId: null,
      },
      {
        fileName: "second.jsonl",
        chronologySource: "FIRST_RECORD_TIMESTAMP",
        chronologyTimestamp: 200,
        lastRecordTimestamp: 250,
        runtimeSessionId: null,
      },
    ]),
    (error) => error.code === "HARVESTER_JOURNAL_SESSION_ORDER_AMBIGUOUS",
    "Overlapping event ranges must never be flattened into a fabricated total order.",
  )
})

test("rejects duplicate process-session identities", () => {
  assert.throws(
    () => validateAndOrderSessions([
      {
        fileName: "first.jsonl",
        chronologySource: "PROCESS_STARTED",
        chronologyTimestamp: 100,
        lastRecordTimestamp: 150,
        runtimeSessionId: "duplicate-run",
      },
      {
        fileName: "second.jsonl",
        chronologySource: "PROCESS_STARTED",
        chronologyTimestamp: 200,
        lastRecordTimestamp: 250,
        runtimeSessionId: "duplicate-run",
      },
    ]),
    (error) => error.code === "HARVESTER_JOURNAL_DUPLICATE_SESSION_ID",
    "A runtime session ID must identify at most one discovered Journal session.",
  )
})
