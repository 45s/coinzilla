import path from "node:path"
import { createHistoryError } from "./journal-history-errors.js"

const PROCESS_SESSION_DIRECTORY_PATTERN = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-(.+)$/

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

export function resolveSessionChronology({ records, directory }) {
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

function validateSessionChronologyAvailability({ sessions }) {
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
}

function validateUniqueSessionChronology({ sessions }) {
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
}

function validateOrderedSessionRanges({ orderedSessions }) {
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
}

export function validateAndOrderSessions(sessions) {
  if (sessions.length <= 1) {
    if (sessions.length === 1) {
      sessions[0].chronologySource = "SINGLE_SESSION"
    }
    return sessions
  }
  validateSessionChronologyAvailability({ sessions })
  validateUniqueSessionChronology({ sessions })
  const orderedSessions = orderSessionsByChronology({ sessions })
  validateOrderedSessionRanges({ orderedSessions })
  return orderedSessions
}
