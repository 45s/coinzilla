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

function createHistoryError({ code, message, details, cause }) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) error.details = details
  if (cause !== undefined) error.cause = cause
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
      throw new TypeError(name + " must be a positive safe integer")
    }
  }
}

function toRelativePath({ rootDirectory, absolutePath }) {
  return path.relative(rootDirectory, absolutePath).split(path.sep).join("/")
}

function parseTimestamp(value) {
  if (typeof value !== "string" || value.trim() === "") return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function parseProcessStarted({ records, directory }) {
  const startedRecords = records.filter((record) => record.payload?.name === "harvester.process_started")
  if (startedRecords.length > 1) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_PROCESS_IDENTITY_INVALID",
      message: "Journal session contains more than one harvester.process_started record: " + directory,
      details: { directory, count: startedRecords.length },
    })
  }
  if (startedRecords.length === 0) return undefined

  const data = startedRecords[0].payload?.data
  const startedAt = data?.startedAt
  const runtimeSessionId = data?.runtimeSessionId
  const processId = data?.processId
  const timestamp = parseTimestamp(startedAt)
  if (
    data?.application !== "harvester" ||
    timestamp === undefined ||
    new Date(timestamp).toISOString() !== startedAt ||
    typeof runtimeSessionId !== "string" ||
    runtimeSessionId.trim() === "" ||
    !Number.isSafeInteger(processId) ||
    processId < 1
  ) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_PROCESS_IDENTITY_INVALID",
      message: "Journal session has invalid process-start identity metadata: " + directory,
      details: { directory, startedAt, runtimeSessionId, processId },
    })
  }

  const directoryName = path.basename(directory)
  const directoryMatch = PROCESS_SESSION_DIRECTORY_PATTERN.exec(directoryName)
  if (directoryMatch) {
    const expectedTimestamp = startedAt.slice(0, 19)
      .replace("T", "_")
      .replaceAll(":", "-")
    const expectedSessionId = runtimeSessionId.replace(/[^a-zA-Z0-9_-]/g, "-")
    if (directoryMatch[1] !== expectedTimestamp || directoryMatch[2] !== expectedSessionId) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_PROCESS_IDENTITY_MISMATCH",
        message: "Process-start identity does not match its session directory: " + directory,
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

  return Object.freeze({
    chronologySource: "PROCESS_STARTED",
    chronologyTimestamp: timestamp,
    startedAt,
    runtimeSessionId,
    processId,
  })
}

function resolveSessionChronology({ records, directory }) {
  const processStarted = parseProcessStarted({ records, directory })
  // process_started is best-effort and may be appended after runtime startup;
  // its payload.startedAt is chronology metadata, not a trading-event boundary.
  const chronologyRecords = processStarted
    ? records.filter((record) => record.payload?.name !== "harvester.process_started")
    : records
  const eventTimestamps = chronologyRecords.map((record) => parseTimestamp(record.payload?.timestamp))
  const timestampsAreValid = eventTimestamps.every((timestamp) => timestamp !== undefined)
  const timestampsAreMonotonic = timestampsAreValid && eventTimestamps.every(
    (timestamp, index) => index === 0 || timestamp >= eventTimestamps[index - 1],
  )

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

  const firstRecordTimestamp = eventTimestamps[0]
  const lastRecordTimestamp = eventTimestamps.at(-1)
  if (processStarted) {
    if (eventTimestamps.some((timestamp) => timestamp < processStarted.chronologyTimestamp)) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_PROCESS_IDENTITY_INVALID",
        message: "A Journal event timestamp precedes its process-start timestamp: " + directory,
        details: { directory, startedAt: processStarted.startedAt },
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

function validateAndOrderSessions(sessions) {
  if (sessions.length <= 1) {
    if (sessions.length === 1) {
      sessions[0].chronologySource = "SINGLE_SESSION"
    }
    return sessions
  }

  const sources = new Set(sessions.map((session) => session.chronologySource))
  if (sources.has("UNAVAILABLE") || sources.size !== 1) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_SESSION_ORDER_AMBIGUOUS",
      message: "Journal sessions do not share a comparable, explicit chronology source",
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
          message: "Duplicate runtime session identity in Journal history: " + session.runtimeSessionId,
          details: { runtimeSessionId: session.runtimeSessionId },
        })
      }
      identities.add(session.runtimeSessionId)
    }
  }

  sessions.sort((left, right) => left.chronologyTimestamp - right.chronologyTimestamp)

  for (let index = 1; index < sessions.length; index += 1) {
    const previous = sessions[index - 1]
    const current = sessions[index]
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

  return sessions
}

async function discoverSessionDirectories({
  sessionsRoot,
  maxDirectories,
  maxSessions,
}) {
  const discovered = []
  let directoriesVisited = 0
  let sessionsDiscovered = 0

  async function walk(directory, { isRoot = false } = {}) {
    directoriesVisited += 1
    if (directoriesVisited > maxDirectories) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_DISCOVERY_LIMIT_EXCEEDED",
        message: "Harvester Journal session discovery exceeds maxDirectories",
        details: { maxDirectories, directory },
      })
    }

    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (cause) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
        message: "Unable to enumerate Journal session directory: " + directory,
        details: { directory },
        cause,
      })
    }

    const symbolicLinks = entries.filter((entry) => entry.isSymbolicLink())
    if (symbolicLinks.length > 0) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
        message: "Symbolic links make Journal session discovery incomplete: " + directory,
        details: { directory, entries: symbolicLinks.map((entry) => entry.name) },
      })
    }

    const journalEntries = entries.filter((entry) => entry.name.endsWith(".jsonl"))
    const invalidJournalEntries = journalEntries.filter((entry) => !entry.isFile())
    if (invalidJournalEntries.length > 0) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
        message: "A Journal session entry is not a regular file: " + directory,
        details: { directory, entries: invalidJournalEntries.map((entry) => entry.name) },
      })
    }

    const childDirectories = entries.filter((entry) => entry.isDirectory())
    const unknownEntries = entries.filter((entry) => !entry.isDirectory() && !entry.isFile())
    if (unknownEntries.length > 0) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
        message: "Unsupported filesystem entry in Journal session tree: " + directory,
        details: { directory, entries: unknownEntries.map((entry) => entry.name) },
      })
    }

    if (journalEntries.length > 0) {
      sessionsDiscovered += journalEntries.length
      if (sessionsDiscovered > maxSessions) {
        throw createHistoryError({
          code: "JOURNAL_RECOVERY_LIMIT_EXCEEDED",
          message: "Harvester Journal history exceeds maxSessions during discovery",
          details: { maxSessions, sessionsDiscovered, directory },
        })
      }
      discovered.push({
        directory,
        fileNames: journalEntries.map((entry) => entry.name).sort(),
      })
    } else if (!isRoot && childDirectories.length === 0) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_SESSION_MISSING",
        message: "Discovered process-session directory has no Journal JSONL file: " + directory,
        details: { directory },
      })
    } else if (!isRoot && entries.some((entry) => entry.isFile())) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
        message: "Journal session container has files but no session record file: " + directory,
        details: { directory, entries: entries.filter((entry) => entry.isFile()).map((entry) => entry.name) },
      })
    } else if (isRoot && entries.some((entry) => entry.isFile() && !entry.name.endsWith(".jsonl"))) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
        message: "Unexpected file in Journal sessions root: " + directory,
        details: { directory, entries: entries.filter((entry) => entry.isFile()).map((entry) => entry.name) },
      })
    }

    childDirectories.sort((left, right) => left.name.localeCompare(right.name))
    for (const child of childDirectories) {
      await walk(path.join(directory, child.name))
    }
  }

  await walk(sessionsRoot, { isRoot: true })
  return { directories: discovered, directoriesVisited }
}

/**
 * Read legacy flat Journal sessions and nested per-process session folders.
 *
 * This is a forensic history reader, not an ADR-0001 durable-fact reader.
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
  logger = { info() {}, error() {} },
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
    validateLimits({ maxDirectories, maxSessions, maxRecords, maxBytes, maxRecordBytes })

    const rootDirectory = path.resolve(directory)
    const rootEntries = await readdir(rootDirectory, { withFileTypes: true })
    const rootIsSessionsDirectory = path.basename(rootDirectory) === "sessions"
    const sessionDirectories = []
    let directoriesVisited = 0

    if (rootIsSessionsDirectory) {
      const discovered = await discoverSessionDirectories({
        sessionsRoot: rootDirectory,
        maxDirectories,
        maxSessions,
      })
      sessionDirectories.push(...discovered.directories)
      directoriesVisited = discovered.directoriesVisited
    } else {
      const rootJournalEntries = rootEntries.filter((entry) => entry.name.endsWith(".jsonl"))
      const invalidRootJournalEntries = rootJournalEntries.filter((entry) => !entry.isFile())
      if (invalidRootJournalEntries.length > 0) {
        throw createHistoryError({
          code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
          message: "A root-level Journal session entry is not a regular file: " + rootDirectory,
          details: { directory: rootDirectory, entries: invalidRootJournalEntries.map((entry) => entry.name) },
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
        if (!sessionsEntry.isDirectory()) {
          throw createHistoryError({
            code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
            message: "Harvester sessions path is not a readable directory: " + path.join(rootDirectory, "sessions"),
            details: { directory: path.join(rootDirectory, "sessions") },
          })
        }
        const discovered = await discoverSessionDirectories({
          sessionsRoot: path.join(rootDirectory, "sessions"),
          maxDirectories,
          maxSessions,
        })
        sessionDirectories.push(...discovered.directories)
        directoriesVisited = discovered.directoriesVisited
      }
    }

    const totalDiscoveredSessions = sessionDirectories.reduce((count, entry) => count + entry.fileNames.length, 0)
    if (totalDiscoveredSessions > maxSessions) {
      throw createHistoryError({
        code: "JOURNAL_RECOVERY_LIMIT_EXCEEDED",
        message: "Harvester Journal history exceeds maxSessions",
        details: { maxSessions, discoveredSessions: totalDiscoveredSessions },
      })
    }

    const sessions = []
    let recordsRead = 0
    let bytesRead = 0
    for (const entry of sessionDirectories) {
      const journal = journalFactory({ directory: entry.directory, logger })
      if (!journal || typeof journal.read !== "function") {
        throw new TypeError("Harvester Journal history reader must provide read()")
      }

      const result = await journal.read({
        maxRecords: Math.max(1, maxRecords - recordsRead),
        maxSessions: Math.max(1, maxSessions - sessions.length),
        maxBytes: Math.max(1, maxBytes - bytesRead),
        maxRecordBytes,
      })
      if (result?.ok !== true) {
        if (result?.ok === false) return result
        return toResult({ error: new TypeError("Harvester Journal history read returned an invalid result") })
      }
      if (
        !Array.isArray(result.records) ||
        !Array.isArray(result.sessions) ||
        !Number.isSafeInteger(result.bytesRead) ||
        result.bytesRead < 0
      ) {
        throw new TypeError("Harvester Journal history reader returned an invalid validated snapshot")
      }

      const actualNames = new Set(result.sessions)
      for (const fileName of entry.fileNames) {
        if (!actualNames.has(fileName)) {
          throw createHistoryError({
            code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
            message: "A discovered Journal session was not returned by the Journal reader: " + fileName,
            details: { directory: entry.directory, fileName },
          })
        }
      }
      for (const fileName of result.sessions) {
        if (!entry.fileNames.includes(fileName)) {
          throw createHistoryError({
            code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
            message: "Journal reader returned a session that was not discovered: " + fileName,
            details: { directory: entry.directory, fileName },
          })
        }
      }

      const recordsByFile = new Map(entry.fileNames.map((fileName) => [fileName, []]))
      for (const record of result.records) {
        const fileName = record?.position?.fileName
        if (!recordsByFile.has(fileName)) {
          throw createHistoryError({
            code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
            message: "Journal reader returned a record without a discovered session position",
            details: { directory: entry.directory, fileName },
          })
        }
        recordsByFile.get(fileName).push(record)
      }

      for (const fileName of entry.fileNames) {
        const relativeFileName = toRelativePath({
          rootDirectory,
          absolutePath: path.join(entry.directory, fileName),
        })
        const fileRecords = recordsByFile.get(fileName)
        sessions.push({
          directory: toRelativePath({ rootDirectory, absolutePath: entry.directory }) || ".",
          fileName: relativeFileName,
          records: fileRecords,
          ...resolveSessionChronology({ records: fileRecords, directory: entry.directory }),
        })
      }

      recordsRead += result.records.length
      bytesRead += result.bytesRead
      if (recordsRead > maxRecords || bytesRead > maxBytes) {
        throw createHistoryError({
          code: "JOURNAL_RECOVERY_LIMIT_EXCEEDED",
          message: "Harvester Journal history exceeds its configured read limits",
          details: { maxRecords, recordsRead, maxBytes, bytesRead },
        })
      }
    }

    const recordIds = new Set()
    for (const session of sessions) {
      for (const record of session.records) {
        if (recordIds.has(record.id)) {
          throw createHistoryError({
            code: "JOURNAL_DUPLICATE_RECORD_ID",
            message: "Duplicate journal record id " + record.id + " at " + session.fileName + ":" + record.position.lineNumber,
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

    const orderedSessions = validateAndOrderSessions(sessions)
    const records = orderedSessions.flatMap((session) => session.records.map((record) => ({
      ...record,
      position: {
        ...record.position,
        fileName: session.fileName,
      },
    })))
    const sessionMetadata = orderedSessions.map((session) => ({
      directory: session.directory,
      fileName: session.fileName,
      recordCount: session.records.length,
      chronologySource: session.chronologySource,
      startedAt: session.startedAt,
      runtimeSessionId: session.runtimeSessionId,
      processId: session.processId,
    }))

    return toResult({
      records,
      count: records.length,
      sessions: sessionMetadata,
      sessionCount: sessionMetadata.length,
      bytesRead,
      directoriesVisited,
      discoveryComplete: true,
      ordering: sessionMetadata.length > 1 ? "VALIDATED" : sessionMetadata.length === 1 ? "SINGLE_SESSION" : "EMPTY_SCAN",
    })
  } catch (error) {
    if (error?.code === "ENOENT") {
      const missing = createHistoryError({
        code: "JOURNAL_DIRECTORY_NOT_FOUND",
        message: "Journal history directory does not exist: " + path.resolve(directory),
        details: { directory: path.resolve(directory) },
        cause: error,
      })
      return toResult({ error: missing })
    }
    return toResult({ error })
  }
}
