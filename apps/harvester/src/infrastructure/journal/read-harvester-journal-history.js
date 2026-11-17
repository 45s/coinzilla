import path from "node:path"
import { Journal } from "@coinzilla/journal"
import { toResult } from "@coinzilla/utils"
import { discoverHarvesterJournalSessions } from "./discover-harvester-journal-sessions.js"
import {
  createHistoryError,
  normalizeHistoryReadError,
} from "./helpers/journal-history-errors.js"
import {
  resolveSessionChronology,
  validateAndOrderSessions,
} from "./helpers/resolve-session-chronology.js"

const DEFAULT_LIMITS = Object.freeze({
  maxDirectories: 10_000,
  maxSessions: 10_000,
  maxRecords: 100_000,
  maxBytes: 64 * 1024 * 1024,
  maxRecordBytes: 1024 * 1024,
})

function getSessionOrdering({ sessionCount }) {
  if (sessionCount > 1) { return "VALIDATED" }
  if (sessionCount === 1) { return "SINGLE_SESSION" }
  return "EMPTY_SCAN"
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
function createHistoryReadResult({ records, sessionMetadata, bytesRead, directoriesVisited }) {
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
}

function createHistoryReadErrorResult({ error, directory }) {
  return toResult({
    error: normalizeHistoryReadError({
      error,
      directory,
    }),
  })
}

function validateHistoryReadRequest({
  directory,
  journalFactory,
  maxDirectories,
  maxSessions,
  maxRecords,
  maxBytes,
  maxRecordBytes,
}) {
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
}

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
    validateHistoryReadRequest({
      directory,
      journalFactory,
      maxDirectories,
      maxSessions,
      maxRecords,
      maxBytes,
      maxRecordBytes,
    })

    const rootDirectory = path.resolve(directory)
    const discovery = await discoverHarvesterJournalSessions({
      rootDirectory,
      maxDirectories,
      maxSessions,
    })
    const { sessionDirectories, directoriesVisited } = discovery

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
    return createHistoryReadResult({
      records,
      sessionMetadata,
      bytesRead,
      directoriesVisited,
    })
  } catch (error) {
    return createHistoryReadErrorResult({
      error,
      directory,
    })
  }
}
