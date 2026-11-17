import * as nodeFileSystem from "node:fs/promises"
import path from "node:path"
import {
  canonicalStringifyOperationalStateValue,
  digestOperationalStateRecord,
  normalizeOperationalStateRecordedAt,
  requireNonEmptyString,
} from "./operational-state-canonical.js"
import { toResult } from "@coinzilla/utils"
import {
  DEFAULT_SCHEMA_VERSION,
  FORMAT_VERSION,
  MAX_RECORD_BYTES,
  MAX_RUNTIME_SESSION_ID_LENGTH,
} from "./helpers/operational-state-fact-schema.js"
import {
  createManifestCheckpoint,
  parseJsonLines,
  validateFactInput,
  validateFactRecord,
  validateManifestCheckpoint,
} from "./operational-state-record-validation.js"

const FACTS_FILE_NAME = "facts.jsonl"
const MANIFEST_FILE_NAME = "manifest.jsonl"
const operationQueues = new Map()
const supportsPosixModeBits = process.platform !== "win32"

function createError(...parameters) {
  const [message, code] = parameters
  const error = new Error(message)
  error.code = code
  return error
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
 * @param {string} options.directory - Stable per-installation Operational State Store record directory.
 * @param {string} options.runtimeSessionId - Current process-session identity.
 * @param {number} [options.schemaVersion=1] - Operational State Store record schema version.
 * @param {() => Date|string} [options.now] - Injectable canonical timestamp source.
 * @param {object} [options.fileSystem] - Injectable Node fs/promises-compatible adapter.
 * @returns {Readonly<object>} Operational State Store records application port.
 */
function createOperationalStateStoreContext({
  directory,
  runtimeSessionId,
  schemaVersion = DEFAULT_SCHEMA_VERSION,
  now = () => new Date(),
  fileSystem = nodeFileSystem,
}) {
  const resolvedDirectory = requireNonEmptyString({ value: directory,
field: "directory" })
  const resolvedRuntimeSessionId = requireNonEmptyString({
    value: runtimeSessionId,
    field: "runtimeSessionId",
    maxLength: MAX_RUNTIME_SESSION_ID_LENGTH,
  })
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new TypeError("Operational State Store record schemaVersion must be a positive safe integer")
  }
  if (typeof now !== "function") {
    throw new TypeError("Operational State Store record now must be a function")
  }
  for (const method of ["mkdir", "open", "readFile", "readdir", "lstat", "chmod"]) {
    if (typeof fileSystem?.[method] !== "function") {
      throw new TypeError(`Operational State Store record fileSystem requires ${method}`)
    }
  }

  const absoluteDirectory = path.resolve(resolvedDirectory)
  return {
    runtimeSessionId: resolvedRuntimeSessionId,
    schemaVersion,
    now,
    fileSystem,
    absoluteDirectory,
    logPath: path.join(absoluteDirectory, FACTS_FILE_NAME),
    manifestPath: path.join(absoluteDirectory, MANIFEST_FILE_NAME),
    writeUncertain: false,
  }
}

function createOperationalStateStoreCoordination({ store }) {
  const assertNoUncertainWrite = () => {
    if (store.writeUncertain) {
      throw createError(
        "A previous Operational State Store record write has an uncertain commit outcome; create a fresh store instance and verify before proceeding",
        "DURABLE_FACTS_COMMIT_UNCERTAIN",
      )
    }
  }

  const serialize = (task) => {
    const previous = operationQueues.get(store.absoluteDirectory) ?? Promise.resolve()
    const next = previous.then(task, task)
    operationQueues.set(store.absoluteDirectory, next.then(() => undefined, () => undefined))
    return next
  }

  const syncFile = async (filePath) => {
    const handle = await store.fileSystem.open(filePath, "r+")
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  const syncStreams = async () => {
    await syncFile(store.logPath)
    await syncFile(store.manifestPath)
  }

  return { assertNoUncertainWrite,
serialize,
syncStreams }
}

async function assertOperationalStateStoreDirectoryIsSafe({ store }) {
  const directoryStat = await store.fileSystem.lstat(store.absoluteDirectory)
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error("Operational State Store record directory must be a real directory, not a symlink")
  }
  if (
    supportsPosixModeBits &&
    ((directoryStat.mode & 0o077) !== 0 || (directoryStat.mode & 0o700) !== 0o700)
  ) {
    throw new Error("Operational State Store record directory permissions must be private (0700)")
  }
  const entries = await store.fileSystem.readdir(store.absoluteDirectory)
  const unexpectedEntries = entries.filter((entry) =>
    ![FACTS_FILE_NAME, MANIFEST_FILE_NAME].includes(entry)
  )
  if (unexpectedEntries.length > 0) {
    throw new Error("Operational State Store record directory contains an unresolved temporary or unexpected file")
  }
}

async function assertOperationalStateStoreStreamsAreSafe({ store }) {
  const [logStat, manifestStat] = await Promise.all([
    store.fileSystem.lstat(store.logPath),
    store.fileSystem.lstat(store.manifestPath),
  ])
  if (
    logStat.isSymbolicLink() ||
    !logStat.isFile() ||
    manifestStat.isSymbolicLink() ||
    !manifestStat.isFile()
  ) {
    throw new Error("Operational State Store record streams must be regular files, not symlinks")
  }
  if (
    supportsPosixModeBits &&
    [logStat, manifestStat].some((stat) =>
      (stat.mode & 0o077) !== 0 || (stat.mode & 0o600) !== 0o600
    )
  ) {
    throw new Error("Operational State Store record streams must use private file permissions (0600)")
  }
}

async function readOperationalStateStoreStreams({ store }) {
  const [rawLog, rawManifest] = await Promise.all([
    store.fileSystem.readFile(store.logPath, "utf8"),
    store.fileSystem.readFile(store.manifestPath, "utf8"),
  ])
  return { rawLog,
rawManifest }
}

function validateOperationalStateStoreStreams({ store, rawLog, rawManifest }) {
  const records = parseJsonLines({
    source: rawLog,
    label: "Operational State Store record log",
  })
  const checkpoints = parseJsonLines({
    source: rawManifest,
    label: "Committed-head manifest journal",
  })
  if (checkpoints.length < records.length) {
    throw new Error("Operational State record exists beyond the committed-head manifest journal")
  }
  if (checkpoints.length > records.length) {
    throw new Error("Committed-head manifest journal is ahead of the Operational State Store record log")
  }
  const factIds = new Set()
  let previousFactDigest = null
  let previousManifestDigest = null
  for (let index = 0; index < records.length; index += 1) {
    const expectedSequence = BigInt(index).toString()
    const record = records[index]
    validateFactRecord({
      record,
      schemaVersion: store.schemaVersion,
      expectedSequence,
      previousDigest: previousFactDigest,
      index,
    })
    if (factIds.has(record.factId)) {
      throw new Error("Operational State record identity is duplicated in the append-only stream")
    }
    factIds.add(record.factId)
    const checkpoint = checkpoints[index]
    validateManifestCheckpoint({
      checkpoint,
      schemaVersion: store.schemaVersion,
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

function createOperationalStateStoreVerifier({ store }) {
  return async function verifyState() {
    await assertOperationalStateStoreDirectoryIsSafe({ store })
    await assertOperationalStateStoreStreamsAreSafe({ store })
    const { rawLog, rawManifest } = await readOperationalStateStoreStreams({ store })
    return validateOperationalStateStoreStreams({ store,
rawLog,
rawManifest })
  }
}

async function writeOperationalStateGenesisFact({ store, genesisRecord, writeState }) {
  const logHandle = await store.fileSystem.open(store.logPath, "wx", 0o600)
  try {
    writeState.factWriteStarted = true
    await logHandle.writeFile(`${canonicalStringifyOperationalStateValue(genesisRecord)}\n`, "utf8")
    await logHandle.sync()
  } finally {
    await logHandle.close()
  }
}

async function writeOperationalStateGenesisManifest({ store, genesisCheckpointBody, writeState }) {
  const manifestHandle = await store.fileSystem.open(store.manifestPath, "wx", 0o600)
  try {
    writeState.manifestWriteStarted = true
    await manifestHandle.writeFile(`${canonicalStringifyOperationalStateValue(genesisCheckpointBody)}\n`, "utf8")
    await manifestHandle.sync()
  } finally {
    await manifestHandle.close()
  }
}

function createOperationalStateStoreInitializer({
  store,
  serialize,
  assertNoUncertainWrite,
  syncStreams,
  verifyState,
}) {
  return () => serialize(async () => {
    const writeState = { factWriteStarted: false,
manifestWriteStarted: false }
    try {
      assertNoUncertainWrite()
      await store.fileSystem.mkdir(store.absoluteDirectory, {
        recursive: true,
        mode: 0o700,
      })
      const directoryStat = await store.fileSystem.lstat(store.absoluteDirectory)
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        throw new Error("Operational State Store record initialization requires a real directory")
      }
      const entries = await store.fileSystem.readdir(store.absoluteDirectory)
      if (entries.length > 0) {
        throw new Error("Operational State Store record initialization refuses to overwrite an existing directory")
      }
      if (supportsPosixModeBits) {
        await store.fileSystem.chmod(store.absoluteDirectory, 0o700)
      }
      const recordedAt = normalizeOperationalStateRecordedAt(store.now())
      const genesisBody = {
        formatVersion: FORMAT_VERSION,
        schemaVersion: store.schemaVersion,
        sequence: "0",
        factId: "durable-facts:genesis",
        factType: "LEDGER_INITIALIZED",
        runtimeSessionId: store.runtimeSessionId,
        recordedAt,
        previousDigest: null,
        data: { schemaVersion: store.schemaVersion },
      }
      const genesisRecord = {
        ...genesisBody,
        digest: digestOperationalStateRecord(genesisBody),
      }
      await writeOperationalStateGenesisFact({ store,
genesisRecord,
writeState })
      const genesisCheckpointBody = createManifestCheckpoint({
        schemaVersion: store.schemaVersion,
        record: genesisRecord,
        previousManifestDigest: null,
      })
      await writeOperationalStateGenesisManifest({ store,
genesisCheckpointBody,
writeState })
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
      if (writeState.factWriteStarted || writeState.manifestWriteStarted) {
        store.writeUncertain = true
        error.code = "DURABLE_FACTS_COMMIT_UNCERTAIN"
      } else if (!error.code) {
        error.code = "DURABLE_FACTS_INITIALIZATION_FAILED"
      }
      return toResult({ error })
    }
  })
}

async function synchronizeOperationalStateBeforeAppend({ syncStreams, writeState }) {
  try {
    await syncStreams()
  } catch (error) {
    if (error.code !== "ENOENT") {
      writeState.syncFailed = true
    }
    throw error
  }
}

async function verifyOperationalStateBeforeAppend({ verifyState, writeState }) {
  try {
    return await verifyState()
  } catch (error) {
    writeState.integrityFailed = true
    throw error
  }
}

function assertDuplicateOperationalStateFactMatches({ existing, input }) {
  if (
    existing.factType !== input.factType ||
    canonicalStringifyOperationalStateValue(existing.data) !== canonicalStringifyOperationalStateValue(input.data)
  ) {
    throw createError("Operational State record ID was reused with a different payload", "DURABLE_FACT_ID_CONFLICT")
  }
}

function validateMarketHistoryCoverageProgress({ state, input, recordedAt }) {
  if (input.factType !== "MARKET_HISTORY_COVERAGE_CONFIRMED") {
    return
  }
  const nowTime = new Date(recordedAt).getTime()
  if (!Number.isSafeInteger(nowTime) || input.data.verifiedAt > nowTime) {
    throw new Error("Market-history coverage verification timestamp cannot be in the future")
  }
  const previousCoverageRecords = state.records.filter((record) =>
    record.factType === "MARKET_HISTORY_COVERAGE_CONFIRMED" &&
    record.data.symbol === input.data.symbol
  )
  let previousCoverage
  for (const record of previousCoverageRecords) {
    if (previousCoverage && record.data.coveredFromTime > previousCoverage.data.coveredFromTime) {
      throw new Error(`Existing durable market-history coverage narrows the verified history window for ${input.data.symbol}`)
    }
    if (previousCoverage && record.data.verifiedAt < previousCoverage.data.verifiedAt) {
      throw new Error(`Existing durable market-history coverage verification timestamp regresses for ${input.data.symbol}`)
    }
    previousCoverage = record
  }
  if (previousCoverage && input.data.coveredFromTime > previousCoverage.data.coveredFromTime) {
    throw new Error(`Market-history coverage must not narrow the verified history window for ${input.data.symbol}`)
  }
  if (previousCoverage && input.data.verifiedAt < previousCoverage.data.verifiedAt) {
    throw new Error(`Market-history coverage verification timestamp must be monotonic for ${input.data.symbol}`)
  }
}

function createOperationalStateAppendRecord({ store, state, input, recordedAt }) {
  const sequence = (BigInt(state.manifest.sequence) + 1n).toString()
  const body = {
    formatVersion: FORMAT_VERSION,
    schemaVersion: store.schemaVersion,
    sequence,
    factId: input.factId,
    factType: input.factType,
    runtimeSessionId: input.runtimeSessionId,
    recordedAt,
    previousDigest: state.lastRecord.digest,
    data: input.data,
  }
  const record = { ...body,
digest: digestOperationalStateRecord(body) }
  const line = canonicalStringifyOperationalStateValue(record)
  if (Buffer.byteLength(line, "utf8") > MAX_RECORD_BYTES) {
    throw new RangeError(`Operational State record exceeds the ${MAX_RECORD_BYTES} byte limit`)
  }
  return { record,
line }
}

async function writeOperationalStateFactRecord({ store, line, writeState }) {
  const logHandle = await store.fileSystem.open(store.logPath, "a", 0o600)
  try {
    writeState.factWriteStarted = true
    await logHandle.writeFile(`${line}\n`, "utf8")
    await logHandle.sync()
  } finally {
    await logHandle.close()
  }
}

async function writeOperationalStateManifestCheckpoint({ store, state, record, writeState }) {
  const checkpoint = createManifestCheckpoint({
    schemaVersion: store.schemaVersion,
    record,
    previousManifestDigest: state.manifest.digest,
  })
  const manifestLine = canonicalStringifyOperationalStateValue(checkpoint)
  if (Buffer.byteLength(manifestLine, "utf8") > MAX_RECORD_BYTES) {
    throw new RangeError(`Committed-head manifest checkpoint exceeds the ${MAX_RECORD_BYTES} byte limit`)
  }
  const manifestHandle = await store.fileSystem.open(store.manifestPath, "a", 0o600)
  try {
    writeState.manifestWriteStarted = true
    await manifestHandle.writeFile(`${manifestLine}\n`, "utf8")
    await manifestHandle.sync()
  } finally {
    await manifestHandle.close()
  }
}

function handleOperationalStateAppendFailure({ store, writeState, error }) {
  if (
    writeState.factWriteStarted ||
    writeState.manifestWriteStarted ||
    writeState.syncFailed ||
    writeState.integrityFailed
  ) {
    store.writeUncertain = true
    error.code = "DURABLE_FACTS_COMMIT_UNCERTAIN"
  } else if (!error.code) {
    error.code = "DURABLE_FACTS_APPEND_FAILED"
  }
  return toResult({ error })
}

function createOperationalStateStoreAppender({
  store,
  serialize,
  assertNoUncertainWrite,
  syncStreams,
  verifyState,
}) {
  return (fact) => serialize(async () => {
    const writeState = {
      factWriteStarted: false,
      manifestWriteStarted: false,
      syncFailed: false,
      integrityFailed: false,
    }
    try {
      assertNoUncertainWrite()
      await synchronizeOperationalStateBeforeAppend({ syncStreams,
writeState })
      const state = await verifyOperationalStateBeforeAppend({ verifyState,
writeState })
      const input = validateFactInput({
        fact,
        runtimeSessionId: store.runtimeSessionId,
      })
      const existing = state.records.find((record) => record.factId === input.factId)
      if (existing) {
        assertDuplicateOperationalStateFactMatches({ existing,
input })
        return toResult({
          data: {
            durable: true,
            duplicate: true,
            record: existing,
          },
        })
      }
      const recordedAt = normalizeOperationalStateRecordedAt(store.now())
      validateMarketHistoryCoverageProgress({ state,
input,
recordedAt })
      const { record, line } = createOperationalStateAppendRecord({
        store,
        state,
        input,
        recordedAt,
      })
      await writeOperationalStateFactRecord({ store,
line,
writeState })
      await writeOperationalStateManifestCheckpoint({ store,
state,
record,
writeState })
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
      return handleOperationalStateAppendFailure({ store,
writeState,
error })
    }
  })
}

function createOperationalStateStoreVerificationOperation({
  store,
  serialize,
  assertNoUncertainWrite,
  syncStreams,
  verifyState,
}) {
  return () => serialize(async () => {
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
        store.writeUncertain = true
        error.code = "DURABLE_FACTS_COMMIT_UNCERTAIN"
      }
      return toResult({ error })
    }
  })
}

function createOperationalStateStoreReadAllOperation({
  store,
  serialize,
  assertNoUncertainWrite,
  syncStreams,
  verifyState,
}) {
  return () => serialize(async () => {
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
        store.writeUncertain = true
        error.code = "DURABLE_FACTS_COMMIT_UNCERTAIN"
      }
      return toResult({ error })
    }
  })
}

function createOperationalStateStoreOperations({ store }) {
  const coordination = createOperationalStateStoreCoordination({ store })
  const verifyState = createOperationalStateStoreVerifier({ store })
  const initialize = createOperationalStateStoreInitializer({ store,
...coordination,
verifyState })
  const append = createOperationalStateStoreAppender({ store,
...coordination,
verifyState })
  const verify = createOperationalStateStoreVerificationOperation({ store,
...coordination,
verifyState })
  const readAll = createOperationalStateStoreReadAllOperation({ store,
...coordination,
verifyState })
  return Object.freeze({
    runtimeSessionId: store.runtimeSessionId,
    initialize,
    append,
    verify,
    readAll,
  })
}

export function createFileOperationalStateStore(options = {}) {
  const store = createOperationalStateStoreContext(options)
  return createOperationalStateStoreOperations({ store })
}
