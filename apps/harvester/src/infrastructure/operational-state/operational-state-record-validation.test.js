import assert from "node:assert/strict"
import test from "node:test"
import {
  canonicalStringifyOperationalStateValue,
  digestOperationalStateRecord,
} from "./operational-state-canonical.js"
import {
  createManifestCheckpoint,
  parseJsonLines,
  validateFactInput,
  validateFactRecord,
  validateManifestCheckpoint,
} from "./operational-state-record-validation.js"

const SCHEMA_VERSION = 1
const GENESIS_BODY = {
  formatVersion: 1,
  schemaVersion: SCHEMA_VERSION,
  sequence: "0",
  factId: "durable-facts:genesis",
  factType: "LEDGER_INITIALIZED",
  runtimeSessionId: "test-session",
  recordedAt: "2026-11-17T00:00:00.000Z",
  previousDigest: null,
  data: { schemaVersion: SCHEMA_VERSION },
}
const GENESIS_RECORD = {
  ...GENESIS_BODY,
  digest: digestOperationalStateRecord(GENESIS_BODY),
}

test("accepts a canonical process-stop fact bound to its runtime session", () => {
  const fact = validateFactInput({
    fact: {
      factId: "process-stopped:test-session",
      factType: "PROCESS_STOPPED",
      data: {
        reason: "NORMAL_SHUTDOWN",
        clean: true,
      },
    },
    runtimeSessionId: "test-session",
  })

  assert.deepEqual(
    fact,
    {
      factId: "process-stopped:test-session",
      factType: "PROCESS_STOPPED",
      runtimeSessionId: "test-session",
      data: {
        reason: "NORMAL_SHUTDOWN",
        clean: true,
      },
    },
    "A valid process-stop fact must retain its stable identity, session binding, and canonical payload.",
  )
})

test("rejects process-stop facts whose stable identity belongs to another runtime session", () => {
  assert.throws(
    () => validateFactInput({
      fact: {
        factId: "process-stopped:other-session",
        factType: "PROCESS_STOPPED",
        data: {
        reason: "NORMAL_SHUTDOWN",
        clean: true,
      },
      },
      runtimeSessionId: "test-session",
    }),
    /factId must match its runtime session identity/,
    "A process-stop fact must not be recorded under an identity from a different process session.",
  )
})

test("rejects unknown fact types, implicit genesis appends, and non-object fact data", () => {
  assert.throws(
    () => validateFactInput({
      fact: {
        factId: "unknown",
        factType: "NOT_ALLOWLISTED",
        data: {},
      },
      runtimeSessionId: "test-session",
    }),
    /not allowlisted/,
    "Unknown fact types must never enter the append-only durable ledger.",
  )
  assert.throws(
    () => validateFactInput({
      fact: {
        factId: "genesis",
        factType: "LEDGER_INITIALIZED",
        data: { schemaVersion: 1 },
      },
      runtimeSessionId: "test-session",
    }),
    /not allowlisted/,
    "Genesis must only be created by the explicit initialization operation, never by append.",
  )
  assert.throws(
    () => validateFactInput({
      fact: {
        factId: "bad-data",
        factType: "PROCESS_STOPPED",
        data: [],
      },
      runtimeSessionId: "test-session",
    }),
    /plain object/,
    "Array payloads must not be accepted as durable fact data objects.",
  )
})

test("validates genesis envelope, sequence, schema, and digest integrity", () => {
  assert.doesNotThrow(
    () => validateFactRecord({
      record: GENESIS_RECORD,
      schemaVersion: SCHEMA_VERSION,
      expectedSequence: "0",
      previousDigest: null,
      index: 0,
    }),
    "The canonical genesis record must satisfy the first-record stream contract.",
  )

  assert.throws(
    () => validateFactRecord({
      record: {
        ...GENESIS_RECORD,
        sequence: "1",
      },
      schemaVersion: SCHEMA_VERSION,
      expectedSequence: "0",
      previousDigest: null,
      index: 0,
    }),
    /sequence gap or reordering/,
    "A genesis record with a non-zero sequence must be rejected as a broken stream.",
  )

  assert.throws(
    () => validateFactRecord({
      record: {
        ...GENESIS_RECORD,
        digest: "0".repeat(64),
      },
      schemaVersion: SCHEMA_VERSION,
      expectedSequence: "0",
      previousDigest: null,
      index: 0,
    }),
    /digest mismatch/,
    "A modified record payload must not pass its SHA-256 integrity check.",
  )
})

test("creates and validates a committed-head checkpoint linked to the exact fact record", () => {
  const checkpoint = createManifestCheckpoint({
    schemaVersion: SCHEMA_VERSION,
    record: GENESIS_RECORD,
    previousManifestDigest: null,
  })

  assert.doesNotThrow(
    () => validateManifestCheckpoint({
      checkpoint,
      schemaVersion: SCHEMA_VERSION,
      factRecord: GENESIS_RECORD,
      expectedSequence: "0",
      previousManifestDigest: null,
      index: 0,
    }),
    "A checkpoint for the exact genesis record must validate before durability is acknowledged.",
  )

  assert.throws(
    () => validateManifestCheckpoint({
      checkpoint: {
        ...checkpoint,
        lastCommittedDigest: "f".repeat(64),
      },
      schemaVersion: SCHEMA_VERSION,
      factRecord: GENESIS_RECORD,
      expectedSequence: "0",
      previousManifestDigest: null,
      index: 0,
    }),
    /does not reference the matching fact record/,
    "A checkpoint pointing at a different fact digest must be rejected.",
  )
})

test("parses only complete newline-terminated canonical JSONL records", () => {
  const canonicalLine = canonicalStringifyOperationalStateValue({
    alpha: 1,
    beta: "two",
  })
  assert.deepEqual(
    parseJsonLines({
      source: `${canonicalLine}\n`,
      label: "test ledger",
    }),
    [{
      alpha: 1,
      beta: "two",
    }],
    "A complete canonical JSONL record must be returned without changing its payload.",
  )

  assert.throws(
    () => parseJsonLines({
      source: canonicalLine,
      label: "test ledger",
    }),
    /newline-terminated/,
    "A final partial line must not be mistaken for a committed record.",
  )
  assert.throws(
    () => parseJsonLines({
      source: `${canonicalLine}\n\n`,
      label: "test ledger",
    }),
    /empty or partial/,
    "An empty line inside the append-only stream must be rejected.",
  )
  assert.throws(
    () => parseJsonLines({
      source: '{"beta":"two","alpha":1}\n',
      label: "test ledger",
    }),
    /not canonical JSON/,
    "Equivalent JSON with non-canonical key order must not bypass byte-stable serialization.",
  )
})
