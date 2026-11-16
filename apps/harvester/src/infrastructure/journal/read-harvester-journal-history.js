import { readdir } from "node:fs/promises"
import path from "node:path"
import { Journal } from "@coinzilla/journal"
import { toResult } from "@coinzilla/utils"

const DEFAULT_LIMITS = Object.freeze({
  maxDirectories: 10_000,
  maxSessions: 10_000,
  maxRecords: 100_000,
  maxBytes: 64 * 1024 * 1024,
  maxRecordBytes: 1024 * 1024,
})
const PROCESS_SESSION_DIRECTORY_PATTERN = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-(.+)$/

function getSessionOrdering({ sessionCount }) {
  if (sessionCount > 1) { return "VALIDATED" }
  if (sessionCount === 1) { return "SINGLE_SESSION" }
  return "EMPTY_SCAN"
}

function createHistoryError({ code, message, details, cause }) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) { error.details = details }
  if (cause !== undefined) { error.cause = cause }
  return error
}

function validateLimits({ maxDirectories, maxSessions, maxRecords, maxBytes, maxRecordBytes }) {
  for (const [name, value] of Object.entries({
    maxDirectories,
    maxSessions,
    maxRecords,
    maxBytes,
    maxRecordBytes,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${name  } must be a positive safe integer`)
    }
  }
}

function toRelativePath({ rootDirectory, absolutePath }) {
  return path.relative(rootDirectory, absolutePath).split(path.sep).join("/")
}

function parseTimestamp(value) {
  if (typeof value !== "string" || value.trim() === "") { return undefined }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function hasValidProcessStartedMetadata({
  source,
  eventTimestamp,
  startedAt,
  timestamp,
  runtimeSessionId,
  processId,
}) {
  return source === "harvester" &&
    eventTimestamp !== undefined &&
    timestamp !== undefined &&
    eventTimestamp >= timestamp &&
    new Date(timestamp).toISOString() === startedAt &&
    typeof runtimeSessionId === "string" &&
    runtimeSessionId.trim() !== "" &&
    Number.isSafeInteger(processId) &&
    processId >= 1
}

function assertProcessStartedDirectoryMatches({
  directory,
  startedAt,
  runtimeSessionId,
}) {
  const directoryMatch = PROCESS_SESSION_DIRECTORY_PATTERN.exec(path.basename(directory))
  if (!directoryMatch) {
    return
  }

  const expectedTimestamp = startedAt.slice(0, 19)
    .replace("T", "_")
    .replaceAll(":", "-")
  const expectedSessionId = runtimeSessionId.replace(/[^a-zA-Z0-9_-]/g, "-")
  if (directoryMatch[1] !== expectedTimestamp || directoryMatch[2] !== expectedSessionId) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_PROCESS_IDENTITY_MISMATCH",
      message: `Process-start identity does not match its session directory: ${directory}`,
      details: {
        directory,
        expectedTimestamp,
        actualTimestamp: directoryMatch[1],
        expectedSessionId,
        actualSessionId: directoryMatch[2],
      },
    })
  }
}

function parseProcessStarted({ records, directory }) {
  const startedRecords = records.filter((record) => record.payload?.name === "harvester.process_started")
  if (startedRecords.length > 1) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_PROCESS_IDENTITY_INVALID",
      message: `Journal session contains more than one harvester.process_started record: ${directory}`,
      details: { directory,
count: startedRecords.length },
    })
  }
  if (startedRecords.length === 0) {
    return undefined
  }

  const [firstStartedRecord] = startedRecords
  const processStartedEvent = firstStartedRecord.payload
  const data = processStartedEvent?.data
  const startedAt = data?.startedAt
  const runtimeSessionId = data?.runtimeSessionId
  const processId = data?.processId
  const timestamp = parseTimestamp(startedAt)
  const eventTimestamp = parseTimestamp(processStartedEvent?.timestamp)
  if (!hasValidProcessStartedMetadata({
    source: processStartedEvent?.source,
    eventTimestamp,
    startedAt,
    timestamp,
    runtimeSessionId,
    processId,
  })) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_PROCESS_IDENTITY_INVALID",
      message: `Journal session has invalid process-start identity metadata: ${directory}`,
      details: { directory,
startedAt,
runtimeSessionId,
processId },
    })
  }

  assertProcessStartedDirectoryMatches({ directory,
startedAt,
runtimeSessionId })
  return Object.freeze({
    chronologySource: "PROCESS_STARTED",
    chronologyTimestamp: timestamp,
    startedAt,
    runtimeSessionId,
    processId,
  })
}
function isTimestampSequenceMonotonic({ timestamps }) {
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index]
    if (timestamp === undefined || (index > 0 && timestamp < timestamps[index - 1])) {
      return false
    }
  }
  return true
}

function resolveSessionChronology({ records, directory }) {
  const processStarted = parseProcessStarted({ records,
directory })
  // process_started is best-effort and may be appended after runtime startup;
  // its payload.startedAt is chronology metadata, not a trading-event boundary.
  const chronologyRecords = processStarted
    ? records.filter((record) => record.payload?.name !== "harvester.process_started")
    : records
  const eventTimestamps = chronologyRecords.map((record) => parseTimestamp(record.payload?.timestamp))
  const timestampsAreMonotonic = isTimestampSequenceMonotonic({ timestamps: eventTimestamps })

  if (!timestampsAreMonotonic) {
    return Object.freeze({
      chronologySource: "UNAVAILABLE",
      chronologyTimestamp: undefined,
      firstRecordTimestamp: undefined,
      lastRecordTimestamp: undefined,
      startedAt: processStarted?.startedAt ?? null,
      runtimeSessionId: processStarted?.runtimeSessionId ?? null,
      processId: processStarted?.processId ?? null,
    })
  }

  const [firstRecordTimestamp] = eventTimestamps
  const lastRecordTimestamp = eventTimestamps.at(-1)
  if (processStarted) {
    if (eventTimestamps.some((timestamp) => timestamp < processStarted.chronologyTimestamp)) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_PROCESS_IDENTITY_INVALID",
        message: `A Journal event timestamp precedes its process-start timestamp: ${  directory}`,
        details: { directory,
startedAt: processStarted.startedAt },
      })
    }
    return Object.freeze({
      ...processStarted,
      firstRecordTimestamp: firstRecordTimestamp ?? processStarted.chronologyTimestamp,
      lastRecordTimestamp: lastRecordTimestamp ?? processStarted.chronologyTimestamp,
    })
  }

  if (firstRecordTimestamp === undefined) {
    return Object.freeze({
      chronologySource: "UNAVAILABLE",
      chronologyTimestamp: undefined,
      firstRecordTimestamp: undefined,
      lastRecordTimestamp: undefined,
      startedAt: null,
      runtimeSessionId: null,
      processId: null,
    })
  }

  return Object.freeze({
    chronologySource: "FIRST_RECORD_TIMESTAMP",
    chronologyTimestamp: firstRecordTimestamp,
    firstRecordTimestamp,
    lastRecordTimestamp,
    startedAt: null,
    runtimeSessionId: null,
    processId: null,
  })
}

function orderSessionsByChronology({ sessions }) {
  const orderedSessions = []
  for (const session of sessions) {
    let insertionIndex = orderedSessions.length
    while (
      insertionIndex > 0 &&
      orderedSessions[insertionIndex - 1].chronologyTimestamp > session.chronologyTimestamp
    ) {
      insertionIndex -= 1
    }
    orderedSessions.splice(insertionIndex, 0, session)
  }
  return orderedSessions
}

function validateAndOrderSessions(sessions) {
  if (sessions.length <= 1) {
    if (sessions.length === 1) {
      sessions[0].chronologySource = "SINGLE_SESSION"
    }
    return sessions
  }

  const sources = new Set(sessions.map((session) => session.chronologySource))
  if (sources.has("UNAVAILABLE")) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_SESSION_ORDER_AMBIGUOUS",
      message: "One or more Journal sessions have no usable chronology evidence",
      details: {
        sessions: sessions.map(({ fileName, chronologySource, startedAt }) => ({
          fileName,
          chronologySource,
          startedAt,
        })),
      },
    })
  }

  const identities = new Set()
  const timestamps = new Set()
  for (const session of sessions) {
    if (session.chronologyTimestamp === undefined || timestamps.has(session.chronologyTimestamp)) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_SESSION_ORDER_AMBIGUOUS",
        message: "Journal session chronology is missing or duplicated; session order cannot be proven",
        details: {
          fileName: session.fileName,
          chronologySource: session.chronologySource,
          startedAt: session.startedAt,
        },
      })
    }
    timestamps.add(session.chronologyTimestamp)

    if (session.runtimeSessionId !== null) {
      if (identities.has(session.runtimeSessionId)) {
        throw createHistoryError({
          code: "HARVESTER_JOURNAL_DUPLICATE_SESSION_ID",
          message: `Duplicate runtime session identity in Journal history: ${  session.runtimeSessionId}`,
          details: { runtimeSessionId: session.runtimeSessionId },
        })
      }
      identities.add(session.runtimeSessionId)
    }
  }

  const orderedSessions = orderSessionsByChronology({ sessions })

  for (let index = 1; index < orderedSessions.length; index += 1) {
    const previous = orderedSessions[index - 1]
    const current = orderedSessions[index]
    if (
      previous.lastRecordTimestamp === undefined ||
      current.chronologyTimestamp === undefined ||
      previous.lastRecordTimestamp >= current.chronologyTimestamp
    ) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_SESSION_ORDER_AMBIGUOUS",
        message: "Journal session event ranges overlap; a safe flattened chronology cannot be established",
        details: {
          previousSession: previous.fileName,
          previousLastRecordTimestamp: previous.lastRecordTimestamp,
          nextSession: current.fileName,
          nextChronologyTimestamp: current.chronologyTimestamp,
        },
      })
    }
  }

  return orderedSessions
}

async function readSessionDirectoryEntries({ directory }) {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch (cause) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
      message: `Unable to enumerate Journal session directory: ${directory}`,
      details: { directory },
      cause,
    })
  }
}

function validateSessionDirectoryEntries({ directory, entries }) {
  const symbolicLinks = entries.filter((entry) => entry.isSymbolicLink())
  if (symbolicLinks.length > 0) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
      message: `Symbolic links make Journal session discovery incomplete: ${directory}`,
      details: { directory,
entries: symbolicLinks.map((entry) => entry.name) },
    })
  }

  const journalEntries = entries.filter((entry) => entry.name.endsWith(".jsonl"))
  const invalidJournalEntries = journalEntries.filter((entry) => !entry.isFile())
  if (invalidJournalEntries.length > 0) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
      message: `A Journal session entry is not a regular file: ${directory}`,
      details: { directory,
entries: invalidJournalEntries.map((entry) => entry.name) },
    })
  }

  const childDirectories = entries.filter((entry) => entry.isDirectory())
  const unknownEntries = entries.filter((entry) => !entry.isDirectory() && !entry.isFile())
  if (unknownEntries.length > 0) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
      message: `Unsupported filesystem entry in Journal session tree: ${directory}`,
      details: { directory,
entries: unknownEntries.map((entry) => entry.name) },
    })
  }

  return { journalEntries,
childDirectories }
}

function recordDiscoveredSessionDirectory({
  directory,
  entries,
  journalEntries,
  childDirectories,
  isRoot,
  maxSessions,
  state,
}) {
  if (journalEntries.length > 0) {
    state.sessionsDiscovered += journalEntries.length
    if (state.sessionsDiscovered > maxSessions) {
      throw createHistoryError({
        code: "JOURNAL_RECOVERY_LIMIT_EXCEEDED",
        message: "Harvester Journal history exceeds maxSessions during discovery",
        details: { maxSessions,
sessionsDiscovered: state.sessionsDiscovered,
directory },
      })
    }
    state.discovered.push({
      directory,
      fileNames: journalEntries.map((entry) => entry.name).sort(),
    })
    return
  }

  if (!isRoot && childDirectories.length === 0) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_SESSION_MISSING",
      message: `Discovered process-session directory has no Journal JSONL file: ${directory}`,
      details: { directory },
    })
  }
  if (!isRoot && entries.some((entry) => entry.isFile())) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
      message: `Journal session container has files but no session record file: ${directory}`,
      details: { directory,
entries: entries.filter((entry) => entry.isFile()).map((entry) => entry.name) },
    })
  }
  if (isRoot && entries.some((entry) => entry.isFile() && !entry.name.endsWith(".jsonl"))) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
      message: `Unexpected file in Journal sessions root: ${directory}`,
      details: { directory,
entries: entries.filter((entry) => entry.isFile()).map((entry) => entry.name) },
    })
  }
}

function sortDirectoriesByName({ directories }) {
  const sortedDirectories = []
  for (const directory of directories) {
    let insertionIndex = sortedDirectories.length
    while (
      insertionIndex > 0 &&
      sortedDirectories[insertionIndex - 1].name.localeCompare(directory.name) > 0
    ) {
      insertionIndex -= 1
    }
    sortedDirectories.splice(insertionIndex, 0, directory)
  }
  return sortedDirectories
}

async function walkSessionDirectories({
  directory,
  isRoot = false,
  state,
  maxDirectories,
  maxSessions,
}) {
  state.directoriesVisited += 1
  if (state.directoriesVisited > maxDirectories) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_DISCOVERY_LIMIT_EXCEEDED",
      message: "Harvester Journal session discovery exceeds maxDirectories",
      details: { maxDirectories,
directory },
    })
  }

  const entries = await readSessionDirectoryEntries({ directory })
  const { journalEntries, childDirectories } = validateSessionDirectoryEntries({ directory,
entries })
  recordDiscoveredSessionDirectory({
    directory,
    entries,
    journalEntries,
    childDirectories,
    isRoot,
    maxSessions,
    state,
  })

  for (const child of sortDirectoriesByName({ directories: childDirectories })) {
    await walkSessionDirectories({
      directory: path.join(directory, child.name),
      state,
      maxDirectories,
      maxSessions,
    })
  }
}

async function discoverSessionDirectories({ sessionsRoot, maxDirectories, maxSessions }) {
  const state = {
    discovered: [],
    directoriesVisited: 0,
    sessionsDiscovered: 0,
  }
  await walkSessionDirectories({
    directory: sessionsRoot,
    isRoot: true,
    state,
    maxDirectories,
    maxSessions,
  })
  return {
    directories: state.discovered,
    directoriesVisited: state.directoriesVisited,
  }
}

/**
 * Read legacy flat Journal sessions and nested per-process session folders.
 *
 * This is a forensic history reader, not an Operational State Store reader.
 * It validates every discovered session before returning a flattened sequence.
 * When several sessions exist, their order must be established by unique
 * process-start metadata or unique first-record timestamps for legacy files;
 * their persisted event ranges must also be strictly non-overlapping.
 * Random runtime IDs and second-resolution filenames are never ordering keys.
 *
 * @param {{
 *   directory: string,
 *   journalFactory?: (options: object) => object,
 *   logger?: object,
 *   maxDirectories?: number,
 *   maxSessions?: number,
 *   maxRecords?: number,
 *   maxBytes?: number,
 *   maxRecordBytes?: number
 * }} input
 * @returns {Promise<object>} Validated forensic Journal history or a structured failure.
 */
async function discoverRootSessionDirectories({
  rootDirectory,
  rootEntries,
  maxDirectories,
  maxSessions,
}) {
  const sessionDirectories = []
  let directoriesVisited = 0
  if (path.basename(rootDirectory) === "sessions") {
    const discovered = await discoverSessionDirectories({
      sessionsRoot: rootDirectory,
      maxDirectories,
      maxSessions,
    })
    return {
      sessionDirectories: discovered.directories,
      directoriesVisited: discovered.directoriesVisited,
    }
  }

  const rootJournalEntries = rootEntries.filter((entry) => entry.name.endsWith(".jsonl"))
  const invalidRootJournalEntries = rootJournalEntries.filter((entry) => !entry.isFile())
  if (invalidRootJournalEntries.length > 0) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
      message: `A root-level Journal session entry is not a regular file: ${rootDirectory}`,
      details: {
        directory: rootDirectory,
        entries: invalidRootJournalEntries.map((entry) => entry.name),
      },
    })
  }
  if (rootJournalEntries.length > 0) {
    sessionDirectories.push({
      directory: rootDirectory,
      fileNames: rootJournalEntries.map((entry) => entry.name).sort(),
    })
  }

  const sessionsEntry = rootEntries.find((entry) => entry.name === "sessions")
  if (sessionsEntry) {
    const sessionsDirectory = path.join(rootDirectory, "sessions")
    if (!sessionsEntry.isDirectory()) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
        message: `Harvester sessions path is not a readable directory: ${sessionsDirectory}`,
        details: { directory: sessionsDirectory },
      })
    }
    const discovered = await discoverSessionDirectories({
      sessionsRoot: sessionsDirectory,
      maxDirectories,
      maxSessions,
    })
    sessionDirectories.push(...discovered.directories)
    directoriesVisited = discovered.directoriesVisited
  }
  return { sessionDirectories,
directoriesVisited }
}

function assertDiscoveredSessionCount({ sessionDirectories, maxSessions }) {
  let discoveredSessions = 0
  for (const entry of sessionDirectories) {
    discoveredSessions += entry.fileNames.length
  }
  if (discoveredSessions > maxSessions) {
    throw createHistoryError({
      code: "JOURNAL_RECOVERY_LIMIT_EXCEEDED",
      message: "Harvester Journal history exceeds maxSessions",
      details: { maxSessions,
discoveredSessions },
    })
  }
}

function assertJournalReadSnapshot({ result }) {
  if (
    !Array.isArray(result.records) ||
    !Array.isArray(result.sessions) ||
    !Number.isSafeInteger(result.bytesRead) ||
    result.bytesRead < 0
  ) {
    throw new TypeError("Harvester Journal history reader returned an invalid validated snapshot")
  }
}

function assertDiscoveredSessionNamesMatch({ entry, sessionNames }) {
  const actualNames = new Set(sessionNames)
  for (const fileName of entry.fileNames) {
    if (!actualNames.has(fileName)) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
        message: `A discovered Journal session was not returned by the Journal reader: ${fileName}`,
        details: { directory: entry.directory,
fileName },
      })
    }
  }
  for (const fileName of sessionNames) {
    if (!entry.fileNames.includes(fileName)) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
        message: `Journal reader returned a session that was not discovered: ${fileName}`,
        details: { directory: entry.directory,
fileName },
      })
    }
  }
}

function groupJournalRecordsByFile({ entry, records }) {
  const recordsByFile = new Map(entry.fileNames.map((fileName) => [fileName, []]))
  for (const record of records) {
    const { fileName } = record?.position ?? {}
    if (!recordsByFile.has(fileName)) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
        message: "Journal reader returned a record without a discovered session position",
        details: { directory: entry.directory,
fileName },
      })
    }
    recordsByFile.get(fileName).push(record)
  }
  return recordsByFile
}

function createJournalSessions({ entry, recordsByFile, rootDirectory }) {
  const sessions = []
  for (const fileName of entry.fileNames) {
    const relativeFileName = toRelativePath({
      rootDirectory,
      absolutePath: path.join(entry.directory, fileName),
    })
    const fileRecords = recordsByFile.get(fileName)
    sessions.push({
      directory: toRelativePath({
        rootDirectory,
        absolutePath: entry.directory,
      }) || ".",
      fileName: relativeFileName,
      records: fileRecords,
      ...resolveSessionChronology({
        records: fileRecords,
        directory: entry.directory,
      }),
    })
  }
  return sessions
}

async function readJournalDirectory({
  entry,
  journalFactory,
  logger,
  maxRecords,
  maxSessions,
  maxBytes,
  maxRecordBytes,
  recordsRead,
  sessionsRead,
  bytesRead,
  rootDirectory,
}) {
  const journal = journalFactory({ directory: entry.directory,
logger })
  if (!journal || typeof journal.read !== "function") {
    throw new TypeError("Harvester Journal history reader must provide read()")
  }

  const result = await journal.read({
    maxRecords: Math.max(1, maxRecords - recordsRead),
    maxSessions: Math.max(1, maxSessions - sessionsRead),
    maxBytes: Math.max(1, maxBytes - bytesRead),
    maxRecordBytes,
  })
  if (result?.ok !== true) {
    return {
      isFailure: true,
      result: result?.ok === false
        ? result
        : toResult({ error: new TypeError("Harvester Journal history read returned an invalid result") }),
    }
  }

  assertJournalReadSnapshot({ result })
  assertDiscoveredSessionNamesMatch({ entry,
sessionNames: result.sessions })
  const recordsByFile = groupJournalRecordsByFile({ entry,
records: result.records })
  return {
    isFailure: false,
    sessions: createJournalSessions({ entry,
recordsByFile,
rootDirectory }),
    recordsRead: result.records.length,
    bytesRead: result.bytesRead,
  }
}

async function readDiscoveredJournalSessions({
  sessionDirectories,
  journalFactory,
  logger,
  maxRecords,
  maxSessions,
  maxBytes,
  maxRecordBytes,
  rootDirectory,
}) {
  const state = { sessions: [],
recordsRead: 0,
bytesRead: 0 }
  for (const entry of sessionDirectories) {
    const directoryResult = await readJournalDirectory({
      entry,
      journalFactory,
      logger,
      maxRecords,
      maxSessions,
      maxBytes,
      maxRecordBytes,
      recordsRead: state.recordsRead,
      sessionsRead: state.sessions.length,
      bytesRead: state.bytesRead,
      rootDirectory,
    })
    if (directoryResult.isFailure) {
      return directoryResult
    }

    state.sessions.push(...directoryResult.sessions)
    state.recordsRead += directoryResult.recordsRead
    state.bytesRead += directoryResult.bytesRead
    if (state.recordsRead > maxRecords || state.bytesRead > maxBytes) {
      throw createHistoryError({
        code: "JOURNAL_RECOVERY_LIMIT_EXCEEDED",
        message: "Harvester Journal history exceeds its configured read limits",
        details: {
          maxRecords,
          recordsRead: state.recordsRead,
          maxBytes,
          bytesRead: state.bytesRead,
        },
      })
    }
  }
  return { isFailure: false,
...state }
}

function assertUniqueJournalRecordIds({ sessions }) {
  const recordIds = new Set()
  for (const session of sessions) {
    for (const record of session.records) {
      if (recordIds.has(record.id)) {
        throw createHistoryError({
          code: "JOURNAL_DUPLICATE_RECORD_ID",
          message: `Duplicate journal record id ${record.id} at ${session.fileName}:${record.position.lineNumber}`,
          details: {
            fileName: session.fileName,
            lineNumber: record.position.lineNumber,
            recordId: record.id,
          },
        })
      }
      recordIds.add(record.id)
    }
  }
}

function flattenOrderedJournalSessions({ orderedSessions }) {
  const records = []
  const sessionMetadata = []
  for (const session of orderedSessions) {
    for (const record of session.records) {
      records.push({
        ...record,
        position: {
          ...record.position,
          fileName: session.fileName,
        },
      })
    }
    sessionMetadata.push({
      directory: session.directory,
      fileName: session.fileName,
      recordCount: session.records.length,
      chronologySource: session.chronologySource,
      startedAt: session.startedAt,
      runtimeSessionId: session.runtimeSessionId,
      processId: session.processId,
    })
  }
  return { records,
sessionMetadata }
}

function normalizeHistoryReadError({ error, directory }) {
  if (error?.code !== "ENOENT") {
    return error
  }
  const absoluteDirectory = path.resolve(directory)
  return createHistoryError({
    code: "JOURNAL_DIRECTORY_NOT_FOUND",
    message: `Journal history directory does not exist: ${absoluteDirectory}`,
    details: { directory: absoluteDirectory },
    cause: error,
  })
}

/**
 * Read legacy flat Journal sessions and nested per-process session folders.
 *
 * This is a forensic history reader, not an Operational State Store reader.
 * It validates every discovered session before returning a flattened sequence.
 * When several sessions exist, their order must be established by unique
 * process-start metadata or unique first-record timestamps for legacy files;
 * their persisted event ranges must also be strictly non-overlapping.
 * Random runtime IDs and second-resolution filenames are never ordering keys.
 *
 * @param {{
 *   directory: string,
 *   journalFactory?: (options: object) => object,
 *   logger?: object,
 *   maxDirectories?: number,
 *   maxSessions?: number,
 *   maxRecords?: number,
 *   maxBytes?: number,
 *   maxRecordBytes?: number
 * }} input
 * @returns {Promise<object>} Validated forensic Journal history or a structured failure.
 */
export async function readHarvesterJournalHistory({
  directory,
  journalFactory = (options) => new Journal(options),
  logger = { info() {},
error() {} },
  maxDirectories = DEFAULT_LIMITS.maxDirectories,
  maxSessions = DEFAULT_LIMITS.maxSessions,
  maxRecords = DEFAULT_LIMITS.maxRecords,
  maxBytes = DEFAULT_LIMITS.maxBytes,
  maxRecordBytes = DEFAULT_LIMITS.maxRecordBytes,
} = {}) {
  try {
    if (typeof directory !== "string" || directory.trim() === "") {
      throw new TypeError("Harvester Journal history directory must be a non-empty string")
    }
    if (typeof journalFactory !== "function") {
      throw new TypeError("Harvester Journal history journalFactory must be a function")
    }
    validateLimits({
      maxDirectories,
      maxSessions,
      maxRecords,
      maxBytes,
      maxRecordBytes,
    })

    const rootDirectory = path.resolve(directory)
    const rootEntries = await readdir(rootDirectory, { withFileTypes: true })
    const discovery = await discoverRootSessionDirectories({
      rootDirectory,
      rootEntries,
      maxDirectories,
      maxSessions,
    })
    const { sessionDirectories, directoriesVisited } = discovery
    assertDiscoveredSessionCount({
      sessionDirectories,
      maxSessions,
    })

    const readResult = await readDiscoveredJournalSessions({
      sessionDirectories,
      journalFactory,
      logger,
      maxRecords,
      maxSessions,
      maxBytes,
      maxRecordBytes,
      rootDirectory,
    })
    if (readResult.isFailure) {
      return readResult.result
    }

    const { sessions, bytesRead } = readResult
    assertUniqueJournalRecordIds({ sessions })
    const orderedSessions = validateAndOrderSessions(sessions)
    const { records, sessionMetadata } = flattenOrderedJournalSessions({ orderedSessions })
    return toResult({
      records,
      count: records.length,
      sessions: sessionMetadata,
      sessionCount: sessionMetadata.length,
      bytesRead,
      directoriesVisited,
      discoveryComplete: true,
      ordering: getSessionOrdering({ sessionCount: sessionMetadata.length }),
    })
  } catch (error) {
    return toResult({
      error: normalizeHistoryReadError({
        error,
        directory,
      }),
    })
  }
}
