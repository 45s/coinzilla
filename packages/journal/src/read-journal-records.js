import { toResult } from "@coinzilla/utils"
import { parseJournalSession } from "./helpers/journal-record.js"

const DEFAULT_LIMITS = Object.freeze({
  maxRecords: 100_000,
  maxSessions: 10_000,
  maxBytes: 64 * 1024 * 1024,
  maxRecordBytes: 1024 * 1024,
})
const SESSION_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-[a-zA-Z0-9_-]+)?\.jsonl$/

function validateReadOptions({ store, directory, maxRecords, maxSessions, maxBytes, maxRecordBytes }) {
  if (
    !store ||
    typeof store.listSessions !== "function" ||
    typeof store.statSession !== "function" ||
    typeof store.readSession !== "function"
  ) {
    return toResult({
      error: new TypeError("A valid journal persistence store is required"),
    })
  }
  if (typeof directory !== "string" || directory.trim() === "") {
    return toResult({
      error: new TypeError("A journal directory is required"),
    })
  }

  const limits = {
    maxRecords,
    maxSessions,
    maxBytes,
    maxRecordBytes,
  }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      return toResult({
        error: new TypeError(`${name} must be a positive safe integer`),
      })
    }
  }
  return toResult({ valid: true })
}

function createRecoveryError({ code, message, details }) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) {
    error.details = details
  }
  return error
}

async function listValidSessionEntries({ store, directory, maxSessions }) {
  let sessionEntries
  try {
    sessionEntries = await store.listSessions()
  } catch (cause) {
    if (cause.code !== "ENOENT") {
      throw cause
    }

    throw createRecoveryError({
      code: "JOURNAL_DIRECTORY_NOT_FOUND",
      message: `Journal directory does not exist: ${directory}`,
      details: {
        directory,
        cause,
      },
    })
  }

  const validSessionEntries = []
  for (const entry of sessionEntries) {
    if (!entry.name.endsWith(".jsonl")) {
      continue
    }
    if (!entry.isFile || !SESSION_FILE_PATTERN.test(entry.name)) {
      throw createRecoveryError({
        code: "JOURNAL_INVALID_SESSION_FILE",
        message: `Invalid journal session file entry: ${entry.name}`,
      })
    }
    if (validSessionEntries.length >= maxSessions) {
      throw createRecoveryError({
        code: "JOURNAL_RECOVERY_LIMIT_EXCEEDED",
        message: `Journal recovery exceeds maxSessions while scanning ${directory}`,
        details: { maxSessions },
      })
    }
    validSessionEntries.push(entry)
  }

  validSessionEntries.sort((...sortArguments) => {
    const [left, right] = sortArguments
    return compareSessionEntries({
      left,
      right,
    })
  })
  return validSessionEntries
}

function compareSessionEntries({ left, right }) {
  const timestampOrder = left.name.slice(0, 19).localeCompare(right.name.slice(0, 19))
  if (timestampOrder !== 0) {
    return timestampOrder
  }

  const leftSuffix = left.name.slice(19, -6)
  const rightSuffix = right.name.slice(19, -6)
  if (leftSuffix === rightSuffix) {
    return 0
  }
  if (leftSuffix === "") {
    return -1
  }
  if (rightSuffix === "") {
    return 1
  }

  const leftNumericSuffix = /^-(\d+)$/.exec(leftSuffix)
  const rightNumericSuffix = /^-(\d+)$/.exec(rightSuffix)
  if (leftNumericSuffix && rightNumericSuffix) {
    const leftIndex = BigInt(leftNumericSuffix[1])
    const rightIndex = BigInt(rightNumericSuffix[1])
    if (leftIndex !== rightIndex) {
      return leftIndex < rightIndex ? -1 : 1
    }
  } else if (leftNumericSuffix) {
    return -1
  } else if (rightNumericSuffix) {
    return 1
  }

  return leftSuffix < rightSuffix ? -1 : 1
}

async function readSessionRecords({ store, entry, maxBytes, bytesRead, maxRecordBytes }) {
  const fileStats = await store.statSession(entry.name)
  if (bytesRead + fileStats.size > maxBytes) {
    throw createRecoveryError({
      code: "JOURNAL_RECOVERY_LIMIT_EXCEEDED",
      message: `Journal recovery exceeds maxBytes while reading ${entry.name}`,
      details: {
        maxBytes,
        bytesRead,
        nextFileBytes: fileStats.size,
      },
    })
  }

  const contentBuffer = await store.readSession(entry.name)
  const { byteLength: fileBytes } = contentBuffer
  let content
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(contentBuffer)
  } catch (cause) {
    throw createRecoveryError({
      code: "JOURNAL_INVALID_ENCODING",
      message: `Journal session ${entry.name} is not valid UTF-8`,
      details: {
        fileName: entry.name,
        cause,
      },
    })
  }

  const nextBytesRead = bytesRead + fileBytes
  if (nextBytesRead > maxBytes) {
    throw createRecoveryError({
      code: "JOURNAL_RECOVERY_LIMIT_EXCEEDED",
      message: `Journal recovery exceeds maxBytes while reading ${entry.name}`,
      details: {
        maxBytes,
        bytesRead: nextBytesRead,
      },
    })
  }

  const records = parseJournalSession({
    content,
    fileName: entry.name,
    maxRecordBytes,
  })
  return {
    records,
    bytesRead: nextBytesRead,
  }
}

/**
 * Read and validate all sessions in deterministic filename/line order.
 * The configured record and byte limits bound recovery memory and I/O.
 * @param {{ store: object, directory: string, maxRecords?: number, maxSessions?: number, maxBytes?: number, maxRecordBytes?: number }} input
 * @returns {Promise<object>} Result containing the fully validated recovered snapshot or a structured error.
 */
export async function readJournalRecords({
  store,
  directory,
  maxRecords = DEFAULT_LIMITS.maxRecords,
  maxSessions = DEFAULT_LIMITS.maxSessions,
  maxBytes = DEFAULT_LIMITS.maxBytes,
  maxRecordBytes = DEFAULT_LIMITS.maxRecordBytes,
} = {}) {
  const optionsResult = validateReadOptions({
    store,
    directory,
    maxRecords,
    maxSessions,
    maxBytes,
    maxRecordBytes,
  })
  if (!optionsResult.ok) {
    return optionsResult
  }

  try {
    const sessionEntries = await listValidSessionEntries({
      store,
      directory,
      maxSessions,
    })
    const records = []
    const recordIds = new Set()
    const sessions = []
    let bytesRead = 0

    for (const entry of sessionEntries) {
      const sessionResult = await readSessionRecords({
        store,
        entry,
        maxBytes,
        bytesRead,
        maxRecordBytes,
      })
      const { records: sessionRecords, bytesRead: nextBytesRead } = sessionResult
      bytesRead = nextBytesRead

      if (records.length + sessionRecords.length > maxRecords) {
        throw createRecoveryError({
          code: "JOURNAL_RECOVERY_LIMIT_EXCEEDED",
          message: `Journal recovery exceeds maxRecords while reading ${entry.name}`,
          details: {
            maxRecords,
            recordsRead: records.length,
            nextSessionRecords: sessionRecords.length,
          },
        })
      }

      for (const record of sessionRecords) {
        if (recordIds.has(record.id)) {
          throw createRecoveryError({
            code: "JOURNAL_DUPLICATE_RECORD_ID",
            message: `Duplicate journal record id ${record.id} at ${entry.name}:${record.position.lineNumber}`,
            details: {
              ...record.position,
              recordId: record.id,
            },
          })
        }
        recordIds.add(record.id)
        records.push(record)
      }
      sessions.push(entry.name)
    }

    return toResult({
      records,
      count: records.length,
      sessions,
      bytesRead,
    })
  } catch (error) {
    return toResult({ error })
  }
}
