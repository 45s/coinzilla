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

function createProcessStoppedRecord({
  factId = "process-stopped:test-session",
  factType = "PROCESS_STOPPED",
  data = {
    reason: "NORMAL_SHUTDOWN",
    clean: true,
  },
  sequence = "1",
  previousDigest = GENESIS_RECORD.digest,
  recordedAt = "2026-11-17T00:00:01.000Z",
  runtimeSessionId = "test-session",
  formatVersion = 1,
  schemaVersion = SCHEMA_VERSION,
} = {}) {
  const body = {
    formatVersion,
    schemaVersion,
    sequence,
    factId,
    factType,
    runtimeSessionId,
    recordedAt,
    previousDigest,
    data,
  }
  return {
    ...body,
    digest: digestOperationalStateRecord(body),
  }
}

function validateRecord({
  record,
  schemaVersion = SCHEMA_VERSION,
  expectedSequence = "1",
  previousDigest = GENESIS_RECORD.digest,
  index = 1,
}) {
  return validateFactRecord({
    record,
    schemaVersion,
    expectedSequence,
    previousDigest,
    index,
  })
}

const INVALID_RECORD_CASES = [
  {
    description: "a non-object record",
    record: null,
    expectedError: /record must be an object/,
  },
  {
    description: "an array record",
    record: [],
    expectedError: /record must be an object/,
  },
  {
    description: "unknown envelope fields",
    record: {
      ...GENESIS_RECORD,
      unsupported: true,
    },
    expectedError: /missing or unknown envelope fields/,
    index: 0,
    expectedSequence: "0",
    previousDigest: null,
  },
  {
    description: "an unsupported format version",
    record: createProcessStoppedRecord({ formatVersion: 2 }),
    expectedError: /format\/schema version is unsupported/,
  },
  {
    description: "an unsupported schema version",
    record: createProcessStoppedRecord({ schemaVersion: 2 }),
    expectedError: /format\/schema version is unsupported/,
  },
  {
    description: "a non-canonical sequence",
    record: createProcessStoppedRecord({ sequence: "01" }),
    expectedError: /sequence must be a canonical base-10 string/,
  },
  {
    description: "a sequence gap",
    record: createProcessStoppedRecord({ sequence: "2" }),
    expectedError: /sequence gap or reordering/,
  },
  {
    description: "an empty fact identity",
    record: createProcessStoppedRecord({ factId: "" }),
    expectedError: /record.factId must be a canonical non-empty string/,
  },
  {
    description: "an unknown record type",
    record: createProcessStoppedRecord({ factType: "NOT_ALLOWLISTED" }),
    expectedError: /record type is not allowlisted/,
  },
  {
    description: "an empty runtime session identity",
    record: createProcessStoppedRecord({ runtimeSessionId: "" }),
    expectedError: /record.runtimeSessionId must be a canonical non-empty string/,
  },
  {
    description: "a non-canonical recorded-at timestamp",
    record: createProcessStoppedRecord({ recordedAt: "not-a-timestamp" }),
    expectedError: /recorded-at timestamp is not canonical/,
  },
  {
    description: "a non-genesis first record",
    record: createProcessStoppedRecord({
      sequence: "0",
      previousDigest: null,
    }),
    expectedError: /must begin with its explicit genesis record/,
    index: 0,
    expectedSequence: "0",
    previousDigest: null,
  },
  {
    description: "a second genesis record",
    record: {
      ...GENESIS_BODY,
      sequence: "1",
      previousDigest: GENESIS_RECORD.digest,
      digest: digestOperationalStateRecord({
        ...GENESIS_BODY,
        sequence: "1",
        previousDigest: GENESIS_RECORD.digest,
      }),
    },
    expectedError: /second genesis record/,
  },
  {
    description: "a broken previous-digest chain",
    record: createProcessStoppedRecord({
      previousDigest: "f".repeat(64),
    }),
    expectedError: /previous-digest chain is broken/,
  },
  {
    description: "a malformed previous digest",
    record: createProcessStoppedRecord({
      previousDigest: "not-a-sha256-digest",
    }),
    expectedError: /previousDigest must be a SHA-256 digest/,
    previousDigest: "not-a-sha256-digest",
  },
  {
    description: "a malformed record digest",
    record: {
      ...createProcessStoppedRecord(),
      digest: "not-a-sha256-digest",
    },
    expectedError: /record digest is malformed/,
  },
  {
    description: "invalid fact-family payload data",
    record: createProcessStoppedRecord({
      data: {
        reason: "invalid reason",
        clean: true,
      },
    }),
    expectedError: /Process-stop reason and clean marker are invalid/,
  },
]

const VALID_CHECKPOINT = createManifestCheckpoint({
  schemaVersion: SCHEMA_VERSION,
  record: GENESIS_RECORD,
  previousManifestDigest: null,
})

const INVALID_CHECKPOINT_CASES = [
  {
    description: "a null checkpoint",
    checkpoint: null,
    expectedError: /checkpoint must be an object/,
  },
  {
    description: "an array checkpoint",
    checkpoint: [],
    expectedError: /checkpoint must be an object/,
  },
  {
    description: "unknown checkpoint fields",
    checkpoint: {
      ...VALID_CHECKPOINT,
      unsupported: true,
    },
    expectedError: /missing or unknown fields/,
  },
  {
    description: "an unsupported checkpoint version",
    checkpoint: {
      ...VALID_CHECKPOINT,
      formatVersion: 2,
    },
    expectedError: /format\/schema version is unsupported/,
  },
  {
    description: "a malformed checkpoint sequence",
    checkpoint: {
      ...VALID_CHECKPOINT,
      sequence: "01",
    },
    expectedError: /sequence gap or reordering/,
  },
  {
    description: "a checkpoint sequence gap",
    checkpoint: {
      ...VALID_CHECKPOINT,
      sequence: "1",
    },
    expectedError: /sequence gap or reordering/,
  },
  {
    description: "a mismatched record count",
    checkpoint: {
      ...VALID_CHECKPOINT,
      recordCount: "2",
    },
    expectedError: /record count does not match/,
  },
  {
    description: "a broken previous-manifest chain",
    checkpoint: VALID_CHECKPOINT,
    previousManifestDigest: "f".repeat(64),
    expectedError: /previous-digest chain is broken/,
  },
  {
    description: "a malformed previous-manifest digest",
    checkpoint: createManifestCheckpoint({
      schemaVersion: SCHEMA_VERSION,
      record: GENESIS_RECORD,
      previousManifestDigest: "not-a-sha256-digest",
    }),
    previousManifestDigest: "not-a-sha256-digest",
    expectedError: /previous digest is malformed/,
  },
  {
    description: "a malformed checkpoint digest",
    checkpoint: {
      ...VALID_CHECKPOINT,
      digest: "not-a-sha256-digest",
    },
    expectedError: /manifest digest mismatch/,
  },
  {
    description: "a mismatched checkpoint digest",
    checkpoint: {
      ...VALID_CHECKPOINT,
      digest: "0".repeat(64),
    },
    expectedError: /manifest digest mismatch/,
  },
]

test("rejects malformed fact input identities and session bindings", () => {
  const validFact = {
    factId: "process-stopped:test-session",
    factType: "PROCESS_STOPPED",
    data: {
      reason: "NORMAL_SHUTDOWN",
      clean: true,
    },
  }

  assert.throws(
    () => validateFactInput({
      fact: null,
      runtimeSessionId: "test-session",
    }),
    /record must be an object/,
    "Null fact input must not enter the durable ledger.",
  )
  assert.throws(
    () => validateFactInput({
      fact: [],
      runtimeSessionId: "test-session",
    }),
    /record must be an object/,
    "Array fact input must not be treated as a durable fact record.",
  )
  assert.throws(
    () => validateFactInput({
      fact: {
        ...validFact,
        factId: "",
      },
      runtimeSessionId: "test-session",
    }),
    /factId must be a canonical non-empty string/,
    "A fact must have a stable non-empty identity.",
  )
  assert.throws(
    () => validateFactInput({
      fact: {
        ...validFact,
        factType: "",
      },
      runtimeSessionId: "test-session",
    }),
    /factType must be a canonical non-empty string/,
    "A fact must declare a non-empty allowlisted type.",
  )
  assert.throws(
    () => validateFactInput({
      fact: validFact,
      runtimeSessionId: "",
    }),
    /runtimeSessionId must be a non-empty string/,
    "Every durable fact must be bound to a non-empty runtime session identity.",
  )
})

test("rejects malformed record envelopes, sequence chains, digests and payloads", () => {
  for (const invalidRecord of INVALID_RECORD_CASES) {
    assert.throws(
      () => validateRecord(invalidRecord),
      invalidRecord.expectedError,
      "The record validator must reject " + invalidRecord.description + ".",
    )
  }
})

function validateCheckpoint({ checkpoint, previousManifestDigest = null }) {
  return validateManifestCheckpoint({
    checkpoint,
    schemaVersion: SCHEMA_VERSION,
    factRecord: GENESIS_RECORD,
    expectedSequence: "0",
    previousManifestDigest,
    index: 0,
  })
}

test("rejects inconsistent committed-head checkpoint envelopes and digest links", () => {
  for (const invalidCheckpoint of INVALID_CHECKPOINT_CASES) {
    assert.throws(
      () => validateCheckpoint(invalidCheckpoint),
      invalidCheckpoint.expectedError,
      "The committed-head validator must reject " + invalidCheckpoint.description + ".",
    )
  }
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

test("rejects malformed JSON text in the JSONL stream", () => {
  assert.throws(
    () => parseJsonLines({
      source: '{"alpha":}\n',
      label: "test ledger",
    }),
    SyntaxError,
    "Malformed JSON text must be rejected instead of being partially parsed.",
  )
})
