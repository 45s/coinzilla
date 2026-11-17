import {
  canonicalStringifyOperationalStateValue,
  digestOperationalStateRecord,
  requireNonEmptyString,
} from "./operational-state-canonical.js"
import {
  FACT_TYPES,
  FORMAT_VERSION,
  MAX_FACT_ID_LENGTH,
  MAX_RUNTIME_SESSION_ID_LENGTH,
  SEQUENCE_PATTERN,
  SHA256_PATTERN,
} from "./helpers/operational-state-fact-schema.js"
import { validateFactData } from "./operational-state-fact-validation.js"

export function validateFactInput({ fact, runtimeSessionId }) {
  if (!fact || typeof fact !== "object" || Array.isArray(fact)) {
    throw new TypeError("Operational State record must be an object")
  }
  const factId = requireNonEmptyString({ value: fact.factId,
field: "factId",
maxLength: MAX_FACT_ID_LENGTH })
  const factType = requireNonEmptyString({ value: fact.factType,
field: "factType",
maxLength: 64 })
  if (!FACT_TYPES.has(factType) || factType === "LEDGER_INITIALIZED") {
    throw new TypeError(`Operational State record type is not allowlisted: ${  factType}`)
  }
  return {
    factId,
    factType,
    runtimeSessionId: requireNonEmptyString({
      value: runtimeSessionId,
      field: "runtimeSessionId",
      maxLength: MAX_RUNTIME_SESSION_ID_LENGTH,
    }),
    data: validateFactData({ factType,
data: fact.data,
factId,
runtimeSessionId }),
  }
}

function assertOperationalStateRecordEnvelope({
  record,
  schemaVersion,
  expectedSequence,
  index,
}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Operational State record must be an object")
  }
  const expectedKeys = [
    "data",
    "digest",
    "factId",
    "factType",
    "formatVersion",
    "previousDigest",
    "recordedAt",
    "runtimeSessionId",
    "schemaVersion",
    "sequence",
  ]
  if (canonicalStringifyOperationalStateValue(Object.keys(record).sort()) !== canonicalStringifyOperationalStateValue(expectedKeys)) {
    throw new Error("Operational State record contains missing or unknown envelope fields")
  }
  if (record.formatVersion !== FORMAT_VERSION || record.schemaVersion !== schemaVersion) {
    throw new Error("Operational State record format/schema version is unsupported")
  }
  if (typeof record.sequence !== "string" || !SEQUENCE_PATTERN.test(record.sequence)) {
    throw new TypeError("Operational State record sequence must be a canonical base-10 string")
  }
  if (record.sequence !== expectedSequence) {
    throw new Error(`Operational State record sequence gap or reordering at record ${index}`)
  }
  requireNonEmptyString({
    value: record.factId,
    field: "record.factId",
    maxLength: MAX_FACT_ID_LENGTH,
  })
  requireNonEmptyString({
    value: record.factType,
    field: "record.factType",
    maxLength: 64,
  })
  if (!FACT_TYPES.has(record.factType)) {
    throw new Error(`Operational State record type is not allowlisted: ${record.factType}`)
  }
  requireNonEmptyString({
    value: record.runtimeSessionId,
    field: "record.runtimeSessionId",
    maxLength: MAX_RUNTIME_SESSION_ID_LENGTH,
  })
  const recordedAt = requireNonEmptyString({
    value: record.recordedAt,
    field: "record.recordedAt",
  })
  const parsedDate = new Date(recordedAt)
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString() !== recordedAt) {
    throw new Error("Operational State recorded-at timestamp is not canonical ISO-8601")
  }
}

function assertOperationalStateRecordSequenceIntegrity({ record, index, previousDigest, schemaVersion }) {
  if (index === 0) {
    if (
      record.sequence !== "0" ||
      record.factId !== "durable-facts:genesis" ||
      record.factType !== "LEDGER_INITIALIZED" ||
      record.previousDigest !== null ||
      canonicalStringifyOperationalStateValue(record.data) !== canonicalStringifyOperationalStateValue({ schemaVersion })
    ) {
      throw new Error("Operational State Store record stream must begin with its explicit genesis record")
    }
  } else {
    if (record.factType === "LEDGER_INITIALIZED") {
      throw new Error("Operational State Store record stream contains a second genesis record")
    }
    if (record.previousDigest !== previousDigest) {
      throw new Error("Operational State record previous-digest chain is broken")
    }
  }
  if (record.previousDigest !== null && !SHA256_PATTERN.test(record.previousDigest)) {
    throw new TypeError("Operational State record previousDigest must be a SHA-256 digest or null for genesis")
  }
}

function assertOperationalStateRecordPayloadIntegrity({ record, index, schemaVersion }) {
  if (!SHA256_PATTERN.test(record.digest ?? "")) {
    throw new TypeError("Operational State record digest is malformed")
  }
  validateFactData({
    factType: record.factType,
    data: record.data,
    factId: record.factId,
    runtimeSessionId: record.runtimeSessionId,
  })
  if (index === 0 && record.data.schemaVersion !== schemaVersion) {
    throw new Error("Operational State Store genesis schema version does not match the stream schema")
  }
  if (digestOperationalStateRecord(record) !== record.digest) {
    throw new Error(`Operational State record digest mismatch at sequence ${record.sequence}`)
  }
}

export function validateFactRecord({ record, schemaVersion, expectedSequence, previousDigest, index }) {
  assertOperationalStateRecordEnvelope({
    record,
    schemaVersion,
    expectedSequence,
    index,
  })
  assertOperationalStateRecordSequenceIntegrity({
    record,
    index,
    previousDigest,
    schemaVersion,
  })
  assertOperationalStateRecordPayloadIntegrity({
    record,
    index,
    schemaVersion,
  })
}

export function createManifestCheckpoint({ schemaVersion, record, previousManifestDigest }) {
  const body = {
    formatVersion: FORMAT_VERSION,
    schemaVersion,
    sequence: record.sequence,
    lastCommittedDigest: record.digest,
    recordCount: (BigInt(record.sequence) + 1n).toString(),
    previousManifestDigest,
  }
  return { ...body,
digest: digestOperationalStateRecord(body) }
}

export function validateManifestCheckpoint({ checkpoint, schemaVersion, factRecord, expectedSequence, previousManifestDigest, index }) {
  const expectedKeys = [
    "digest", "formatVersion", "lastCommittedDigest", "previousManifestDigest",
    "recordCount", "schemaVersion", "sequence",
  ]
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    throw new TypeError("Committed-head manifest checkpoint must be an object")
  }
  if (canonicalStringifyOperationalStateValue(Object.keys(checkpoint).sort()) !== canonicalStringifyOperationalStateValue(expectedKeys)) {
    throw new Error("Committed-head manifest contains missing or unknown fields")
  }
  if (checkpoint.formatVersion !== FORMAT_VERSION || checkpoint.schemaVersion !== schemaVersion) {
    throw new Error("Committed-head manifest format/schema version is unsupported")
  }
  if (typeof checkpoint.sequence !== "string" || !SEQUENCE_PATTERN.test(checkpoint.sequence) ||
      checkpoint.sequence !== expectedSequence) {
    throw new Error(`Committed-head manifest sequence gap or reordering at record ${  index}`)
  }
  if (checkpoint.recordCount !== String(index + 1)) {
    throw new Error("Committed-head manifest record count does not match its sequence")
  }
  if (checkpoint.lastCommittedDigest !== factRecord.digest) {
    throw new Error("Committed-head manifest does not reference the matching fact record")
  }
  if (checkpoint.previousManifestDigest !== previousManifestDigest) {
    throw new Error("Committed-head manifest previous-digest chain is broken")
  }
  if (checkpoint.previousManifestDigest !== null && !SHA256_PATTERN.test(checkpoint.previousManifestDigest)) {
    throw new TypeError("Committed-head manifest previous digest is malformed")
  }
  if (!SHA256_PATTERN.test(checkpoint.digest ?? "") || digestOperationalStateRecord(checkpoint) !== checkpoint.digest) {
    throw new Error(`Committed-head manifest digest mismatch at sequence ${  checkpoint.sequence}`)
  }
}

export function parseJsonLines({ source, label }) {
  if (typeof source !== "string" || !source.endsWith("\n")) {
    throw new Error(`${label} must end with a complete newline-terminated record`)
  }
  const lines = source.slice(0, -1).split("\n")
  if (lines.length === 0 || lines.some((line) => line === "")) {
    throw new Error(`${label} contains an empty or partial record`)
  }
  const records = []
  for (const [index, line] of lines.entries()) {
    const parsed = JSON.parse(line)
    if (canonicalStringifyOperationalStateValue(parsed) !== line) {
      throw new Error(`${label} is not canonical JSON at line ${index + 1}`)
    }
    records.push(parsed)
  }
  return records
}
