import { createHash } from "node:crypto"
import * as nodeFileSystem from "node:fs/promises"
import path from "node:path"
import { toResult } from "@coinzilla/utils"

const FORMAT_VERSION = 1
const DEFAULT_SCHEMA_VERSION = 1
const MAX_FACT_ID_LENGTH = 256
const MAX_RUNTIME_SESSION_ID_LENGTH = 256
const MAX_FACT_DATA_BYTES = 64 * 1024
const MAX_RECORD_BYTES = 128 * 1024
const MAX_JSON_DEPTH = 12
const MAX_ARRAY_LENGTH = 1024
const MAX_OBJECT_KEYS = 128
const MAX_STRING_LENGTH = 8192
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SEQUENCE_PATTERN = /^(0|[1-9][0-9]*)$/
const SECRET_KEY_PATTERN = /(?:api.?key|secret|password|token|authorization|credential)/i

const FACT_TYPES = new Set([
  "LEDGER_INITIALIZED",
  "PROCESS_STARTED",
  "PROCESS_STOPPED",
  "CONFIGURATION_BASELINE",
  "ORDER_SUBMISSION_INTENT",
  "ORDER_SUBMISSION_OUTCOME",
  "ORDER_CANCELLATION_INTENT",
  "ORDER_CANCELLATION_OUTCOME",
  "EXECUTION_FILL_APPLIED",
  "RECOVERY_CYCLE_COMPLETED",
  "RECOVERY_CYCLE_NOT_COMPLETED",
  "OPERATOR_MARKET_PAUSED",
  "OPERATOR_MARKET_RESUMED",
  "STRATEGY_MARKET_PAUSED",
  "STRATEGY_MARKET_RESUMED",
  "SAFETY_BLOCKER_RAISED",
  "SAFETY_BLOCKER_RESOLVED",
  "ACCOUNT_SNAPSHOT_CAPTURED",
  "ACCOUNT_OPEN_ORDERS_CAPTURED",
])

const FACTS_FILE_NAME = "facts.jsonl"
const MANIFEST_FILE_NAME = "manifest.json"
const MANIFEST_TEMP_FILE_NAME = "manifest.json.tmp"

const operationQueues = new Map()

function createError(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function requireNonEmptyString({ value, field, maxLength = MAX_STRING_LENGTH }) {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim() || value.length > maxLength) {
    throw new TypeError(field + " must be a canonical non-empty string of at most " + maxLength + " characters")
  }
  return value
}

function canonicalize(value, depth = 0) {
  if (depth > MAX_JSON_DEPTH) throw new RangeError("Durable fact JSON exceeds the maximum nesting depth")
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) throw new RangeError("Durable fact string exceeds the maximum length")
    return value
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Durable fact numbers must be safe integers; economic decimals must remain strings")
    }
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) throw new RangeError("Durable fact array exceeds the maximum length")
    return value.map((item) => canonicalize(item, depth + 1))
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Durable fact payloads must contain only plain JSON objects")
    }
    const keys = Object.keys(value).sort()
    if (keys.length > MAX_OBJECT_KEYS) throw new RangeError("Durable fact object exceeds the maximum key count")
    const result = {}
    for (const key of keys) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new TypeError("Durable fact payload contains a forbidden object key")
      }
      if (SECRET_KEY_PATTERN.test(key)) {
        throw new TypeError("Durable fact payload must not contain credentials or secrets")
      }
      if (value[key] === undefined) throw new TypeError("Durable fact payload must not contain undefined values")
      result[key] = canonicalize(value[key], depth + 1)
    }
    return result
  }
  throw new TypeError("Durable fact payload contains a non-JSON value")
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value))
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function digestRecord(record) {
  const { digest, ...body } = record
  return sha256(canonicalStringify(body))
}

function normalizeRecordedAt(now) {
  const value = now()
  const recordedAt = value instanceof Date ? value.toISOString() : String(value)
  const parsed = new Date(recordedAt)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== recordedAt) {
    throw new TypeError("Durable fact recorded-at timestamp must be canonical ISO-8601")
  }
  return recordedAt
}

function validateFactData({ factType, data }) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("Durable fact data must be a plain object")
  }
  const canonicalData = canonicalize(data)
  const byteLength = Buffer.byteLength(JSON.stringify(canonicalData), "utf8")
  if (byteLength > MAX_FACT_DATA_BYTES) {
    throw new RangeError("Durable fact data exceeds the " + MAX_FACT_DATA_BYTES + " byte limit")
  }
  if (factType === "OPERATOR_MARKET_PAUSED" || factType === "OPERATOR_MARKET_RESUMED") {
    requireNonEmptyString({ value: canonicalData.requestId, field: "data.requestId", maxLength: MAX_FACT_ID_LENGTH })
    requireNonEmptyString({ value: canonicalData.actorId, field: "data.actorId", maxLength: MAX_FACT_ID_LENGTH })
    requireNonEmptyString({ value: canonicalData.symbol, field: "data.symbol" })
  }
  if (factType === "LEDGER_INITIALIZED" && (!Number.isSafeInteger(canonicalData.schemaVersion) || canonicalData.schemaVersion < 1)) {
    throw new TypeError("Ledger genesis schemaVersion is unsupported")
  }
  return canonicalData
}

function validateFactInput({ fact, runtimeSessionId }) {
  if (!fact || typeof fact !== "object" || Array.isArray(fact)) {
    throw new TypeError("Durable fact must be an object")
  }
  const factId = requireNonEmptyString({ value: fact.factId, field: "factId", maxLength: MAX_FACT_ID_LENGTH })
  const factType = requireNonEmptyString({ value: fact.factType, field: "factType", maxLength: 64 })
  if (!FACT_TYPES.has(factType) || factType === "LEDGER_INITIALIZED") {
    throw new TypeError("Durable fact type is not allowlisted: " + factType)
  }
  return {
    factId,
    factType,
    runtimeSessionId: requireNonEmptyString({
      value: runtimeSessionId,
      field: "runtimeSessionId",
      maxLength: MAX_RUNTIME_SESSION_ID_LENGTH,
    }),
    data: validateFactData({ factType, data: fact.data }),
  }
}

function validateRecordEnvelope({ record, schemaVersion, expectedSequence, previousDigest, index }) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Durable fact record must be an object")
  }
  const expectedKeys = [
    "data", "digest", "factId", "factType", "formatVersion", "previousDigest",
    "recordedAt", "runtimeSessionId", "schemaVersion", "sequence",
  ]
  if (canonicalStringify(Object.keys(record).sort()) !== canonicalStringify(expectedKeys)) {
    throw new Error("Durable fact record contains missing or unknown envelope fields")
  }
  if (record.formatVersion !== FORMAT_VERSION || record.schemaVersion !== schemaVersion) {
    throw new Error("Durable fact record format/schema version is unsupported")
  }
  if (typeof record.sequence !== "string" || !SEQUENCE_PATTERN.test(record.sequence)) {
    throw new TypeError("Durable fact sequence must be a canonical base-10 string")
  }
  if (record.sequence !== expectedSequence) {
    throw new Error("Durable fact sequence gap or reordering at record " + index)
  }
  requireNonEmptyString({ value: record.factId, field: "record.factId", maxLength: MAX_FACT_ID_LENGTH })
  requireNonEmptyString({ value: record.factType, field: "record.factType", maxLength: 64 })
  if (!FACT_TYPES.has(record.factType)) throw new Error("Durable fact type is not allowlisted: " + record.factType)
  requireNonEmptyString({
    value: record.runtimeSessionId,
    field: "record.runtimeSessionId",
    maxLength: MAX_RUNTIME_SESSION_ID_LENGTH,
  })
  const recordedAt = requireNonEmptyString({ value: record.recordedAt, field: "record.recordedAt" })
  const parsedDate = new Date(recordedAt)
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString() !== recordedAt) {
    throw new Error("Durable fact recorded-at timestamp is not canonical ISO-8601")
  }
  if (index === 0) {
    if (record.sequence !== "0" || record.factId !== "durable-facts:genesis" ||
        record.factType !== "LEDGER_INITIALIZED" || record.previousDigest !== null ||
        canonicalStringify(record.data) !== canonicalStringify({ schemaVersion })) {
      throw new Error("Durable fact stream must begin with its explicit genesis record")
    }
  } else {
    if (record.factType === "LEDGER_INITIALIZED") throw new Error("Durable fact stream contains a second genesis record")
    if (record.previousDigest !== previousDigest) throw new Error("Durable fact previous-digest chain is broken")
  }
  if (record.previousDigest !== null && !SHA256_PATTERN.test(record.previousDigest)) {
    throw new TypeError("Durable fact previousDigest must be a SHA-256 digest or null for genesis")
  }
  if (!SHA256_PATTERN.test(record.digest ?? "")) throw new TypeError("Durable fact digest is malformed")
  validateFactData({ factType: record.factType, data: record.data })
  if (index === 0 && record.data.schemaVersion !== schemaVersion) {
    throw new Error("Durable fact genesis schema version does not match the stream schema")
  }
  if (digestRecord(record) !== record.digest) throw new Error("Durable fact digest mismatch at sequence " + record.sequence)
}

function parseCanonicalJson({ source, label }) {
  if (typeof source !== "string" || !source.endsWith("\n")) {
    throw new Error(label + " must end with a complete newline-terminated record")
  }
  const line = source.slice(0, -1)
  if (line === "" || line.includes("\n")) throw new Error(label + " contains an empty or partial record")
  const parsed = JSON.parse(line)
  if (canonicalStringify(parsed) !== line) throw new Error(label + " is not canonical JSON")
  return parsed
}

function createManifest({ schemaVersion, record }) {
  return {
    formatVersion: FORMAT_VERSION,
    schemaVersion,
    lastCommittedSequence: record.sequence,
    lastCommittedDigest: record.digest,
    recordCount: (BigInt(record.sequence) + 1n).toString(),
  }
}

/**
 * Create the narrow filesystem adapter for ADR-0001's append-only fact stream.
 *
 * initialize() is an explicit one-time operation. Normal startup must call
 * verify()/readAll() and must never create a missing ledger implicitly.
 *
 * @param {object} options
 * @param {string} options.directory - Stable per-installation durable-fact directory.
 * @param {string} options.runtimeSessionId - Current process-session identity.
 * @param {number} [options.schemaVersion=1] - Durable-fact schema version.
 * @param {() => Date|string} [options.now] - Injectable canonical timestamp source.
 * @param {object} [options.fileSystem] - Injectable Node fs/promises-compatible adapter.
 * @returns {Readonly<object>} Durable-facts application port.
 */
export function createFileDurableFactsStore({
  directory,
  runtimeSessionId,
  schemaVersion = DEFAULT_SCHEMA_VERSION,
  now = () => new Date(),
  fileSystem = nodeFileSystem,
} = {}) {
  const resolvedDirectory = requireNonEmptyString({ value: directory, field: "directory" })
  const resolvedRuntimeSessionId = requireNonEmptyString({
    value: runtimeSessionId,
    field: "runtimeSessionId",
    maxLength: MAX_RUNTIME_SESSION_ID_LENGTH,
  })
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new TypeError("Durable-fact schemaVersion must be a positive safe integer")
  }
  if (typeof now !== "function") throw new TypeError("Durable-fact now must be a function")
  for (const method of ["mkdir", "open", "readFile", "readdir", "lstat", "rename"]) {
    if (typeof fileSystem?.[method] !== "function") throw new TypeError("Durable-fact fileSystem requires " + method)
  }

  const absoluteDirectory = path.resolve(resolvedDirectory)
  const logPath = path.join(absoluteDirectory, FACTS_FILE_NAME)
  const manifestPath = path.join(absoluteDirectory, MANIFEST_FILE_NAME)
  const manifestTempPath = path.join(absoluteDirectory, MANIFEST_TEMP_FILE_NAME)
  const serialize = (task) => {
    const previous = operationQueues.get(absoluteDirectory) ?? Promise.resolve()
    const next = previous.then(task, task)
    operationQueues.set(absoluteDirectory, next.then(() => undefined, () => undefined))
    return next
  }

  const syncDirectory = async () => {
    const handle = await fileSystem.open(absoluteDirectory, "r")
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  const writeManifest = async (manifest) => {
    const handle = await fileSystem.open(manifestTempPath, "wx", 0o600)
    try {
      await handle.writeFile(canonicalStringify(manifest) + "\n", "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fileSystem.rename(manifestTempPath, manifestPath)
    await syncDirectory()
  }

  const verifyState = async () => {
    const directoryStat = await fileSystem.lstat(absoluteDirectory)
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new Error("Durable-fact directory must be a real directory, not a symlink")
    }
    const entries = await fileSystem.readdir(absoluteDirectory)
    const unexpectedEntries = entries.filter((entry) =>
      ![FACTS_FILE_NAME, MANIFEST_FILE_NAME].includes(entry))
    if (unexpectedEntries.length > 0) {
      throw new Error("Durable-fact directory contains an unresolved temporary or unexpected file")
    }
    const [logStat, manifestStat] = await Promise.all([
      fileSystem.lstat(logPath),
      fileSystem.lstat(manifestPath),
    ])
    if (logStat.isSymbolicLink() || !logStat.isFile() || manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
      throw new Error("Durable-fact log and manifest must be regular files, not symlinks")
    }
    const [rawLog, rawManifest] = await Promise.all([
      fileSystem.readFile(logPath, "utf8"),
      fileSystem.readFile(manifestPath, "utf8"),
    ])
    if (!rawLog.endsWith("\n")) throw new Error("Durable-fact log has a partial or torn final record")
    if (!rawManifest.endsWith("\n")) throw new Error("Durable-fact manifest is incomplete")
    const lines = rawLog.slice(0, -1).split("\n")
    if (lines.length === 0 || lines.some((line) => line === "")) {
      throw new Error("Durable-fact log contains an empty or partial record")
    }
    const records = []
    const factIds = new Set()
    let previousDigest = null
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const record = JSON.parse(line)
      if (canonicalStringify(record) !== line) throw new Error("Durable-fact record is not canonical JSON at line " + (index + 1))
      validateRecordEnvelope({
        record,
        schemaVersion,
        expectedSequence: BigInt(index).toString(),
        previousDigest,
        index,
      })
      if (factIds.has(record.factId)) throw new Error("Durable fact identity is duplicated in the append-only stream")
      factIds.add(record.factId)
      records.push(record)
      previousDigest = record.digest
    }
    const manifest = parseCanonicalJson({ source: rawManifest, label: "Durable-fact manifest" })
    const expectedManifestKeys = [
      "formatVersion", "lastCommittedDigest", "lastCommittedSequence", "recordCount", "schemaVersion",
    ]
    if (canonicalStringify(Object.keys(manifest).sort()) !== canonicalStringify(expectedManifestKeys)) {
      throw new Error("Durable-fact manifest contains missing or unknown fields")
    }
    if (manifest.formatVersion !== FORMAT_VERSION || manifest.schemaVersion !== schemaVersion) {
      throw new Error("Durable-fact manifest format/schema version is unsupported")
    }
    if (typeof manifest.lastCommittedSequence !== "string" || !SEQUENCE_PATTERN.test(manifest.lastCommittedSequence)) {
      throw new TypeError("Durable-fact manifest sequence is malformed")
    }
    if (!SHA256_PATTERN.test(manifest.lastCommittedDigest ?? "")) {
      throw new TypeError("Durable-fact manifest digest is malformed")
    }
    if (typeof manifest.recordCount !== "string" || !SEQUENCE_PATTERN.test(manifest.recordCount) || manifest.recordCount === "0") {
      throw new TypeError("Durable-fact manifest recordCount is malformed")
    }
    const lastRecord = records.at(-1)
    if (BigInt(manifest.lastCommittedSequence) < BigInt(lastRecord.sequence)) {
      throw new Error("Durable fact record exists beyond the committed manifest head")
    }
    if (BigInt(manifest.lastCommittedSequence) > BigInt(lastRecord.sequence)) {
      throw new Error("Durable-fact log is truncated below the committed manifest head")
    }
    if (manifest.lastCommittedDigest !== lastRecord.digest || manifest.recordCount !== String(records.length)) {
      throw new Error("Durable-fact manifest and verified log head do not agree")
    }
    return { records, manifest, lastRecord }
  }

  const initialize = () => serialize(async () => {
    try {
      await fileSystem.mkdir(absoluteDirectory, { recursive: true, mode: 0o700 })
      const directoryStat = await fileSystem.lstat(absoluteDirectory)
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        throw new Error("Durable-fact initialization requires a real directory")
      }
      const entries = await fileSystem.readdir(absoluteDirectory)
      if (entries.length > 0) throw new Error("Durable-fact initialization refuses to overwrite an existing directory")
      const genesisBody = {
        formatVersion: FORMAT_VERSION,
        schemaVersion,
        sequence: "0",
        factId: "durable-facts:genesis",
        factType: "LEDGER_INITIALIZED",
        runtimeSessionId: resolvedRuntimeSessionId,
        recordedAt: normalizeRecordedAt(now),
        previousDigest: null,
        data: { schemaVersion },
      }
      const record = { ...genesisBody, digest: digestRecord(genesisBody) }
      const handle = await fileSystem.open(logPath, "wx", 0o600)
      try {
        await handle.writeFile(canonicalStringify(record) + "\n", "utf8")
        await handle.sync()
      } finally {
        await handle.close()
      }
      await syncDirectory()
      await writeManifest(createManifest({ schemaVersion, record }))
      const verified = await verifyState()
      return toResult({
        data: {
          durable: true,
          record: verified.lastRecord,
          lastCommittedSequence: verified.manifest.lastCommittedSequence,
          lastCommittedDigest: verified.manifest.lastCommittedDigest,
        },
      })
    } catch (error) {
      if (!error.code) error.code = "DURABLE_FACTS_INITIALIZATION_FAILED"
      return toResult({ error })
    }
  })

  const append = (fact) => serialize(async () => {
    let logSynced = false
    try {
      const state = await verifyState()
      const input = validateFactInput({ fact, runtimeSessionId: resolvedRuntimeSessionId })
      const existing = state.records.find((record) => record.factId === input.factId)
      if (existing) {
        if (existing.factType !== input.factType || canonicalStringify(existing.data) !== canonicalStringify(input.data)) {
          throw createError("Durable factId was reused with a different payload", "DURABLE_FACT_ID_CONFLICT")
        }
        return toResult({ data: { durable: true, duplicate: true, record: existing } })
      }
      const sequence = (BigInt(state.manifest.lastCommittedSequence) + 1n).toString()
      const body = {
        formatVersion: FORMAT_VERSION,
        schemaVersion,
        sequence,
        factId: input.factId,
        factType: input.factType,
        runtimeSessionId: input.runtimeSessionId,
        recordedAt: normalizeRecordedAt(now),
        previousDigest: state.manifest.lastCommittedDigest,
        data: input.data,
      }
      const record = { ...body, digest: digestRecord(body) }
      const line = canonicalStringify(record)
      if (Buffer.byteLength(line, "utf8") > MAX_RECORD_BYTES) {
        throw new RangeError("Durable fact record exceeds the " + MAX_RECORD_BYTES + " byte limit")
      }
      const handle = await fileSystem.open(logPath, "a", 0o600)
      try {
        await handle.writeFile(line + "\n", "utf8")
        await handle.sync()
        logSynced = true
      } finally {
        await handle.close()
      }
      const manifest = createManifest({ schemaVersion, record })
      await writeManifest(manifest)
      const verified = await verifyState()
      return toResult({
        data: {
          durable: true,
          duplicate: false,
          record: verified.lastRecord,
          lastCommittedSequence: verified.manifest.lastCommittedSequence,
          lastCommittedDigest: verified.manifest.lastCommittedDigest,
        },
      })
    } catch (error) {
      if (!error.code) {
        error.code = logSynced ? "DURABLE_FACTS_COMMIT_UNCERTAIN" : "DURABLE_FACTS_APPEND_FAILED"
      }
      return toResult({ error })
    }
  })

  const verify = () => serialize(async () => {
    try {
      const state = await verifyState()
      return toResult({
        data: {
          valid: true,
          recordCount: state.records.length,
          lastCommittedSequence: state.manifest.lastCommittedSequence,
          lastCommittedDigest: state.manifest.lastCommittedDigest,
        },
      })
    } catch (error) {
      return toResult({ error })
    }
  })

  const readAll = () => serialize(async () => {
    try {
      const state = await verifyState()
      return toResult({
        data: {
          records: Object.freeze([...state.records]),
          lastCommittedSequence: state.manifest.lastCommittedSequence,
          lastCommittedDigest: state.manifest.lastCommittedDigest,
        },
      })
    } catch (error) {
      return toResult({ error })
    }
  })

  return Object.freeze({ initialize, append, verify, readAll })
}
