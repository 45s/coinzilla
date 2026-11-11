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
  "MARKET_HISTORY_COVERAGE_CONFIRMED",
])

const FACTS_FILE_NAME = "facts.jsonl"
const MANIFEST_FILE_NAME = "manifest.jsonl"
const operationQueues = new Map()
const supportsPosixModeBits = process.platform !== "win32"

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
    const arrayKeys = Reflect.ownKeys(value)
    if (Object.keys(value).length !== value.length || arrayKeys.length !== value.length + 1 ||
        arrayKeys.some((key) => typeof key !== "string")) {
      throw new TypeError("Durable fact arrays must not contain holes, symbols or custom properties")
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new TypeError("Durable fact arrays must not contain sparse entries")
    }
    return value.map((item) => canonicalize(item, depth + 1))
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Durable fact payloads must contain only plain JSON objects")
    }
    const ownKeys = Reflect.ownKeys(value)
    const keys = Object.keys(value).sort()
    if (ownKeys.length !== keys.length) throw new TypeError("Durable fact objects must not contain symbols or non-enumerable properties")
    if (keys.length > MAX_OBJECT_KEYS) throw new RangeError("Durable fact object exceeds the maximum key count")
    const result = {}
    for (const key of keys) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new TypeError("Durable fact payload contains a forbidden object key")
      }
      if (SECRET_KEY_PATTERN.test(key)) {
        throw new TypeError("Durable fact payload must not contain credentials or secrets")
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        throw new TypeError("Durable fact payload must not contain accessor properties")
      }
      if (descriptor.value === undefined) throw new TypeError("Durable fact payload must not contain undefined values")
      result[key] = canonicalize(descriptor.value, depth + 1)
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
  if (factType === "LEDGER_INITIALIZED" &&
      (!Number.isSafeInteger(canonicalData.schemaVersion) || canonicalData.schemaVersion < 1)) {
    throw new TypeError("Ledger genesis schemaVersion is unsupported")
  }
  if (factType === "MARKET_HISTORY_COVERAGE_CONFIRMED") {
    requireNonEmptyString({ value: canonicalData.symbol, field: "data.symbol" })
    if (!/^[A-Z0-9]{3,30}$/.test(canonicalData.symbol)) {
      throw new TypeError("Market-history coverage symbol must be canonical uppercase alphanumeric")
    }
    requireNonEmptyString({ value: canonicalData.verifiedBy, field: "data.verifiedBy", maxLength: MAX_FACT_ID_LENGTH })
    if (!Number.isSafeInteger(canonicalData.coveredFromTime) || canonicalData.coveredFromTime < 0 ||
        !Number.isSafeInteger(canonicalData.verifiedAt) || canonicalData.verifiedAt < canonicalData.coveredFromTime) {
      throw new TypeError("Market-history coverage timestamps must be non-negative safe integers with verifiedAt >= coveredFromTime")
    }
    if (typeof canonicalData.evidenceDigest !== "string" || !SHA256_PATTERN.test(canonicalData.evidenceDigest)) {
      throw new TypeError("Market-history coverage evidenceDigest must be a SHA-256 digest")
    }
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

function validateFactRecord({ record, schemaVersion, expectedSequence, previousDigest, index }) {
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

function createManifestCheckpoint({ schemaVersion, record, previousManifestDigest }) {
  const body = {
    formatVersion: FORMAT_VERSION,
    schemaVersion,
    sequence: record.sequence,
    lastCommittedDigest: record.digest,
    recordCount: (BigInt(record.sequence) + 1n).toString(),
    previousManifestDigest,
  }
  return { ...body, digest: digestRecord(body) }
}

function validateManifestCheckpoint({ checkpoint, schemaVersion, factRecord, expectedSequence, previousManifestDigest, index }) {
  const expectedKeys = [
    "digest", "formatVersion", "lastCommittedDigest", "previousManifestDigest",
    "recordCount", "schemaVersion", "sequence",
  ]
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    throw new TypeError("Committed-head manifest checkpoint must be an object")
  }
  if (canonicalStringify(Object.keys(checkpoint).sort()) !== canonicalStringify(expectedKeys)) {
    throw new Error("Committed-head manifest contains missing or unknown fields")
  }
  if (checkpoint.formatVersion !== FORMAT_VERSION || checkpoint.schemaVersion !== schemaVersion) {
    throw new Error("Committed-head manifest format/schema version is unsupported")
  }
  if (typeof checkpoint.sequence !== "string" || !SEQUENCE_PATTERN.test(checkpoint.sequence) ||
      checkpoint.sequence !== expectedSequence) {
    throw new Error("Committed-head manifest sequence gap or reordering at record " + index)
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
  if (!SHA256_PATTERN.test(checkpoint.digest ?? "") || digestRecord(checkpoint) !== checkpoint.digest) {
    throw new Error("Committed-head manifest digest mismatch at sequence " + checkpoint.sequence)
  }
}

function parseJsonLines({ source, label }) {
  if (typeof source !== "string" || !source.endsWith("\n")) {
    throw new Error(label + " must end with a complete newline-terminated record")
  }
  const lines = source.slice(0, -1).split("\n")
  if (lines.length === 0 || lines.some((line) => line === "")) {
    throw new Error(label + " contains an empty or partial record")
  }
  return lines.map((line, index) => {
    const parsed = JSON.parse(line)
    if (canonicalStringify(parsed) !== line) {
      throw new Error(label + " is not canonical JSON at line " + (index + 1))
    }
    return parsed
  })
}

/**
 * Create the narrow filesystem adapter for ADR-0001's append-only fact stream.
 *
 * The fact log is fsynced before an append-only committed-head checkpoint is
 * fsynced. A partial checkpoint or a fact record without its matching checkpoint
 * is unresolved and fails closed. Genesis creation is explicit; normal startup
 * must verify/read an existing ledger and must never create one implicitly.
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
  for (const method of ["mkdir", "open", "readFile", "readdir", "lstat", "chmod"]) {
    if (typeof fileSystem?.[method] !== "function") throw new TypeError("Durable-fact fileSystem requires " + method)
  }

  const absoluteDirectory = path.resolve(resolvedDirectory)
  const logPath = path.join(absoluteDirectory, FACTS_FILE_NAME)
  const manifestPath = path.join(absoluteDirectory, MANIFEST_FILE_NAME)
  let writeUncertain = false

  const assertNoUncertainWrite = () => {
    if (writeUncertain) {
      throw createError(
        "A previous durable-fact write has an uncertain commit outcome; create a fresh store instance and verify before proceeding",
        "DURABLE_FACTS_COMMIT_UNCERTAIN",
      )
    }
  }

  const serialize = (task) => {
    const previous = operationQueues.get(absoluteDirectory) ?? Promise.resolve()
    const next = previous.then(task, task)
    operationQueues.set(absoluteDirectory, next.then(() => undefined, () => undefined))
    return next
  }

  const syncFile = async (filePath) => {
    const handle = await fileSystem.open(filePath, "r+")
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  const syncStreams = async () => {
    await syncFile(logPath)
    await syncFile(manifestPath)
  }

  const verifyState = async () => {
    const directoryStat = await fileSystem.lstat(absoluteDirectory)
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new Error("Durable-fact directory must be a real directory, not a symlink")
    }
    if (supportsPosixModeBits &&
        ((directoryStat.mode & 0o077) !== 0 || (directoryStat.mode & 0o700) !== 0o700)) {
      throw new Error("Durable-fact directory permissions must be private (0700)")
    }
    const entries = await fileSystem.readdir(absoluteDirectory)
    const unexpectedEntries = entries.filter((entry) => ![FACTS_FILE_NAME, MANIFEST_FILE_NAME].includes(entry))
    if (unexpectedEntries.length > 0) {
      throw new Error("Durable-fact directory contains an unresolved temporary or unexpected file")
    }
    const [logStat, manifestStat] = await Promise.all([
      fileSystem.lstat(logPath),
      fileSystem.lstat(manifestPath),
    ])
    if (logStat.isSymbolicLink() || !logStat.isFile() ||
        manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
      throw new Error("Durable-fact streams must be regular files, not symlinks")
    }
    if (supportsPosixModeBits && [logStat, manifestStat].some((stat) =>
      (stat.mode & 0o077) !== 0 || (stat.mode & 0o600) !== 0o600)) {
      throw new Error("Durable-fact streams must use private file permissions (0600)")
    }
    const [rawLog, rawManifest] = await Promise.all([
      fileSystem.readFile(logPath, "utf8"),
      fileSystem.readFile(manifestPath, "utf8"),
    ])
    const records = parseJsonLines({ source: rawLog, label: "Durable-fact log" })
    const checkpoints = parseJsonLines({ source: rawManifest, label: "Committed-head manifest journal" })
    if (checkpoints.length < records.length) {
      throw new Error("Durable fact record exists beyond the committed-head manifest journal")
    }
    if (checkpoints.length > records.length) {
      throw new Error("Committed-head manifest journal is ahead of the durable-fact log")
    }
    const factIds = new Set()
    let previousFactDigest = null
    let previousManifestDigest = null
    for (let index = 0; index < records.length; index += 1) {
      const expectedSequence = BigInt(index).toString()
      const record = records[index]
      validateFactRecord({
        record,
        schemaVersion,
        expectedSequence,
        previousDigest: previousFactDigest,
        index,
      })
      if (factIds.has(record.factId)) throw new Error("Durable fact identity is duplicated in the append-only stream")
      factIds.add(record.factId)
      const checkpoint = checkpoints[index]
      validateManifestCheckpoint({
        checkpoint,
        schemaVersion,
        factRecord: record,
        expectedSequence,
        previousManifestDigest,
        index,
      })
      previousFactDigest = record.digest
      previousManifestDigest = checkpoint.digest
    }
    return {
      records,
      checkpoints,
      manifest: checkpoints.at(-1),
      lastRecord: records.at(-1),
    }
  }

  const initialize = () => serialize(async () => {
    let factWriteStarted = false
    let manifestWriteStarted = false
    try {
      assertNoUncertainWrite()
      await fileSystem.mkdir(absoluteDirectory, { recursive: true, mode: 0o700 })
      const directoryStat = await fileSystem.lstat(absoluteDirectory)
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        throw new Error("Durable-fact initialization requires a real directory")
      }
      const entries = await fileSystem.readdir(absoluteDirectory)
      if (entries.length > 0) throw new Error("Durable-fact initialization refuses to overwrite an existing directory")
      if (supportsPosixModeBits) await fileSystem.chmod(absoluteDirectory, 0o700)
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
      const genesisRecord = { ...genesisBody, digest: digestRecord(genesisBody) }
      const logHandle = await fileSystem.open(logPath, "wx", 0o600)
      try {
        factWriteStarted = true
        await logHandle.writeFile(canonicalStringify(genesisRecord) + "\n", "utf8")
        await logHandle.sync()
      } finally {
        await logHandle.close()
      }
      const genesisCheckpointBody = createManifestCheckpoint({
        schemaVersion,
        record: genesisRecord,
        previousManifestDigest: null,
      })
      const manifestHandle = await fileSystem.open(manifestPath, "wx", 0o600)
      try {
        manifestWriteStarted = true
        await manifestHandle.writeFile(canonicalStringify(genesisCheckpointBody) + "\n", "utf8")
        await manifestHandle.sync()
      } finally {
        await manifestHandle.close()
      }
      await syncStreams()
      const verified = await verifyState()
      return toResult({
        data: {
          durable: true,
          record: verified.lastRecord,
          lastCommittedSequence: verified.manifest.sequence,
          lastCommittedDigest: verified.manifest.lastCommittedDigest,
        },
      })
    } catch (error) {
      if (factWriteStarted || manifestWriteStarted) {
        writeUncertain = true
        error.code = "DURABLE_FACTS_COMMIT_UNCERTAIN"
      } else if (!error.code) {
        error.code = "DURABLE_FACTS_INITIALIZATION_FAILED"
      }
      return toResult({ error })
    }
  })

  const append = (fact) => serialize(async () => {
    let factWriteStarted = false
    let manifestWriteStarted = false
    let syncFailed = false
    let integrityFailed = false
    try {
      assertNoUncertainWrite()
      try {
        await syncStreams()
      } catch (error) {
        if (error.code !== "ENOENT") syncFailed = true
        throw error
      }
      let state
      try {
        state = await verifyState()
      } catch (error) {
        integrityFailed = true
        throw error
      }
      const input = validateFactInput({ fact, runtimeSessionId: resolvedRuntimeSessionId })
      const existing = state.records.find((record) => record.factId === input.factId)
      if (existing) {
        if (existing.factType !== input.factType || canonicalStringify(existing.data) !== canonicalStringify(input.data)) {
          throw createError("Durable factId was reused with a different payload", "DURABLE_FACT_ID_CONFLICT")
        }
        return toResult({ data: { durable: true, duplicate: true, record: existing } })
      }
      if (input.factType === "MARKET_HISTORY_COVERAGE_CONFIRMED") {
        const previousCoverageRecords = state.records.filter((record) =>
          record.factType === "MARKET_HISTORY_COVERAGE_CONFIRMED" &&
          record.data.symbol === input.data.symbol
        )
        let previousCoverage
        for (const record of previousCoverageRecords) {
          if (previousCoverage && record.data.coveredFromTime > previousCoverage.data.coveredFromTime) {
            throw new Error("Existing durable market-history coverage narrows the verified history window for " + input.data.symbol)
          }
          if (previousCoverage && record.data.verifiedAt < previousCoverage.data.verifiedAt) {
            throw new Error("Existing durable market-history coverage verification timestamp regresses for " + input.data.symbol)
          }
          previousCoverage = record
        }
        if (previousCoverage && input.data.coveredFromTime > previousCoverage.data.coveredFromTime) {
          throw new Error("Market-history coverage must not narrow the verified history window for " + input.data.symbol)
        }
        if (previousCoverage && input.data.verifiedAt < previousCoverage.data.verifiedAt) {
          throw new Error("Market-history coverage verification timestamp must be monotonic for " + input.data.symbol)
        }
      }
      const sequence = (BigInt(state.manifest.sequence) + 1n).toString()
      const body = {
        formatVersion: FORMAT_VERSION,
        schemaVersion,
        sequence,
        factId: input.factId,
        factType: input.factType,
        runtimeSessionId: input.runtimeSessionId,
        recordedAt: normalizeRecordedAt(now),
        previousDigest: state.lastRecord.digest,
        data: input.data,
      }
      const record = { ...body, digest: digestRecord(body) }
      const line = canonicalStringify(record)
      if (Buffer.byteLength(line, "utf8") > MAX_RECORD_BYTES) {
        throw new RangeError("Durable fact record exceeds the " + MAX_RECORD_BYTES + " byte limit")
      }
      const logHandle = await fileSystem.open(logPath, "a", 0o600)
      try {
        factWriteStarted = true
        await logHandle.writeFile(line + "\n", "utf8")
        await logHandle.sync()
      } finally {
        await logHandle.close()
      }
      const checkpoint = createManifestCheckpoint({
        schemaVersion,
        record,
        previousManifestDigest: state.manifest.digest,
      })
      const manifestLine = canonicalStringify(checkpoint)
      if (Buffer.byteLength(manifestLine, "utf8") > MAX_RECORD_BYTES) {
        throw new RangeError("Committed-head manifest checkpoint exceeds the " + MAX_RECORD_BYTES + " byte limit")
      }
      const manifestHandle = await fileSystem.open(manifestPath, "a", 0o600)
      try {
        manifestWriteStarted = true
        await manifestHandle.writeFile(manifestLine + "\n", "utf8")
        await manifestHandle.sync()
      } finally {
        await manifestHandle.close()
      }
      const verified = await verifyState()
      return toResult({
        data: {
          durable: true,
          duplicate: false,
          record: verified.lastRecord,
          lastCommittedSequence: verified.manifest.sequence,
          lastCommittedDigest: verified.manifest.lastCommittedDigest,
        },
      })
    } catch (error) {
      if (factWriteStarted || manifestWriteStarted || syncFailed || integrityFailed) {
        writeUncertain = true
        error.code = "DURABLE_FACTS_COMMIT_UNCERTAIN"
      } else if (!error.code) {
        error.code = "DURABLE_FACTS_APPEND_FAILED"
      }
      return toResult({ error })
    }
  })

  const verify = () => serialize(async () => {
    try {
      assertNoUncertainWrite()
      await syncStreams()
      const state = await verifyState()
      return toResult({
        data: {
          valid: true,
          durableWriteSupported: true,
          recordCount: state.records.length,
          lastCommittedSequence: state.manifest.sequence,
          lastCommittedDigest: state.manifest.lastCommittedDigest,
        },
      })
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "DURABLE_FACTS_COMMIT_UNCERTAIN") {
        writeUncertain = true
        error.code = "DURABLE_FACTS_COMMIT_UNCERTAIN"
      }
      return toResult({ error })
    }
  })

  const readAll = () => serialize(async () => {
    try {
      assertNoUncertainWrite()
      await syncStreams()
      const state = await verifyState()
      return toResult({
        data: {
          records: Object.freeze([...state.records]),
          durableWriteSupported: true,
          lastCommittedSequence: state.manifest.sequence,
          lastCommittedDigest: state.manifest.lastCommittedDigest,
        },
      })
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "DURABLE_FACTS_COMMIT_UNCERTAIN") {
        writeUncertain = true
        error.code = "DURABLE_FACTS_COMMIT_UNCERTAIN"
      }
      return toResult({ error })
    }
  })

  return Object.freeze({ initialize, append, verify, readAll })
}
