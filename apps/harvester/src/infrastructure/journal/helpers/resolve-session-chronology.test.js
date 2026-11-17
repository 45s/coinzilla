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
  source = "harvester",
} = {}) {
  return {
    payload: {
      name: "harvester.process_started",
      source,
      timestamp: eventTimestamp,
      data: {
        startedAt,
        runtimeSessionId,
        processId,
      },
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

test("uses the first valid event timestamp for legacy sessions and fails closed without timestamps", () => {
  const legacy = resolveSessionChronology({
    records: [
      markerRecord("2026-11-17T00:00:00.010Z"),
      markerRecord("2026-11-17T00:00:00.020Z"),
    ],
    directory: "/tmp/legacy-session.jsonl",
  })
  assert.equal(
    legacy.chronologySource,
    "FIRST_RECORD_TIMESTAMP",
    "A legacy session without process-start metadata must use its first valid event timestamp.",
  )
  assert.equal(
    legacy.lastRecordTimestamp,
    Date.parse("2026-11-17T00:00:00.020Z"),
    "Legacy chronology must retain the final event timestamp for overlap detection.",
  )

  const empty = resolveSessionChronology({
    records: [],
    directory: "/tmp/empty-legacy-session.jsonl",
  })
  assert.equal(
    empty.chronologySource,
    "UNAVAILABLE",
    "A session with no timestamp evidence must not be assigned an invented chronology.",
  )
})

test("rejects invalid process-start metadata and duplicate process-start records", () => {
  const invalidMetadataCases = [
    ["wrong event source", { source: "operator" }],
    ["invalid start timestamp", { startedAt: "not-a-timestamp" }],
    ["event timestamp before startup", { eventTimestamp: "2026-11-16T23:59:59.999Z" }],
    ["empty runtime session identity", { runtimeSessionId: " " }],
    ["invalid process identifier", { processId: 0 }],
  ]

  for (const [description, overrides] of invalidMetadataCases) {
    assert.throws(
      () => resolveSessionChronology({
        records: [processStartedRecord(overrides)],
        directory: SESSION_DIRECTORY,
      }),
      (error) => error.code === "HARVESTER_JOURNAL_PROCESS_IDENTITY_INVALID",
      `Invalid process-start metadata must fail closed when it contains ${description}.`,
    )
  }

  assert.throws(
    () => resolveSessionChronology({
      records: [
        processStartedRecord(),
        processStartedRecord({ eventTimestamp: "2026-11-17T00:00:00.011Z" }),
      ],
      directory: SESSION_DIRECTORY,
    }),
    (error) => error.code === "HARVESTER_JOURNAL_PROCESS_IDENTITY_INVALID",
    "A session must contain exactly one process-start identity record.",
  )
})

test("rejects event evidence before startup and timestamp-mismatched process directories", () => {
  assert.throws(
    () => resolveSessionChronology({
      records: [
        processStartedRecord(),
        markerRecord("2026-11-16T23:59:59.999Z"),
      ],
      directory: SESSION_DIRECTORY,
    }),
    (error) => error.code === "HARVESTER_JOURNAL_PROCESS_IDENTITY_INVALID",
    "No Journal event may predate its validated process-start timestamp.",
  )

  assert.throws(
    () => resolveSessionChronology({
      records: [processStartedRecord()],
      directory: "/tmp/2026-11-16_00-00-00-session-a",
    }),
    (error) => error.code === "HARVESTER_JOURNAL_PROCESS_IDENTITY_MISMATCH",
    "The timestamp encoded in a process-session directory must match its process-start event.",
  )
})

test("uses process-start chronology when no ordinary event records follow startup", () => {
  const chronology = resolveSessionChronology({
    records: [processStartedRecord()],
    directory: SESSION_DIRECTORY,
  })

  assert.equal(
    chronology.chronologySource,
    "PROCESS_STARTED",
    "A valid process-start event is sufficient chronology evidence for an otherwise empty session.",
  )
  assert.equal(
    chronology.firstRecordTimestamp,
    Date.parse(SESSION_STARTED_AT),
    "An empty process session must use its process-start timestamp as its first boundary.",
  )
  assert.equal(
    chronology.lastRecordTimestamp,
    Date.parse(SESSION_STARTED_AT),
    "An empty process session must use its process-start timestamp as its last boundary.",
  )
})

test("rejects unavailable or missing chronology evidence when ordering multiple sessions", () => {
  assert.throws(
    () => validateAndOrderSessions([
      {
        fileName: "known.jsonl",
        chronologySource: "FIRST_RECORD_TIMESTAMP",
        chronologyTimestamp: 100,
        lastRecordTimestamp: 150,
        runtimeSessionId: null,
      },
      {
        fileName: "unknown.jsonl",
        chronologySource: "UNAVAILABLE",
        chronologyTimestamp: undefined,
        lastRecordTimestamp: undefined,
        runtimeSessionId: null,
      },
    ]),
    (error) => error.code === "HARVESTER_JOURNAL_SESSION_ORDER_AMBIGUOUS",
    "A multi-session history with unavailable chronology must fail closed.",
  )

  assert.throws(
    () => validateAndOrderSessions([
      {
        fileName: "missing-timestamp.jsonl",
        chronologySource: "FIRST_RECORD_TIMESTAMP",
        chronologyTimestamp: undefined,
        lastRecordTimestamp: 150,
        runtimeSessionId: null,
      },
      {
        fileName: "known.jsonl",
        chronologySource: "FIRST_RECORD_TIMESTAMP",
        chronologyTimestamp: 200,
        lastRecordTimestamp: 250,
        runtimeSessionId: null,
      },
    ]),
    (error) => error.code === "HARVESTER_JOURNAL_SESSION_ORDER_AMBIGUOUS",
    "A session without a chronology timestamp must not be ordered by filename or directory order.",
  )
})

test("marks a single session without requiring a cross-session ordering proof", () => {
  const [session] = validateAndOrderSessions([
    {
      fileName: "only-session.jsonl",
      chronologySource: "PROCESS_STARTED",
      chronologyTimestamp: 100,
      lastRecordTimestamp: 150,
      runtimeSessionId: "only-run",
    },
  ])

  assert.equal(
    session.chronologySource,
    "SINGLE_SESSION",
    "A single discovered session does not need cross-session chronology evidence.",
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
