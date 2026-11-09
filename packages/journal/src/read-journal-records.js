import { toResult } from "@coinzilla/utils"
import { parseJournalSession } from "./helpers/journal-record.js"

const DEFAULT_LIMITS = Object.freeze({
  maxRecords: 100_000,
  maxSessions: 10_000,
  maxBytes: 64 * 1024 * 1024,
  maxRecordBytes: 1024 * 1024,
})
const SESSION_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+)?\.jsonl$/

function validateReadOptions({ store, directory, maxRecords, maxSessions, maxBytes, maxRecordBytes }) {
  if (!store || typeof store.listSessions !== "function" || typeof store.statSession !== "function" || typeof store.readSession !== "function") {
    return toResult({ error: new TypeError("A valid journal persistence store is required") })
  }
  if (typeof directory !== "string" || directory.trim() === "") {
    return toResult({ error: new TypeError("A journal directory is required") })
  }
  for (const [name, value] of Object.entries({ maxRecords, maxSessions, maxBytes, maxRecordBytes })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      return toResult({ error: new TypeError(`${name} must be a positive safe integer`) })
    }
  }
  return toResult({ valid: true })
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
  const optionsResult = validateReadOptions({ store, directory, maxRecords, maxSessions, maxBytes, maxRecordBytes })
  if (!optionsResult.ok) return optionsResult

  try {
    let sessionEntries
    try {
      sessionEntries = await store.listSessions()
    } catch (cause) {
      if (cause.code === "ENOENT") {
        const error = new Error(`Journal directory does not exist: ${directory}`)
        error.code = "JOURNAL_DIRECTORY_NOT_FOUND"
        error.details = { directory, cause }
        throw error
      }
      throw cause
    }

    const validSessionEntries = []
    for (const entry of sessionEntries) {
      if (!entry.name.endsWith(".jsonl")) continue
      if (!entry.isFile || !SESSION_FILE_PATTERN.test(entry.name)) {
        const error = new Error(`Invalid journal session file entry: ${entry.name}`)
        error.code = "JOURNAL_INVALID_SESSION_FILE"
        throw error
      }
      if (validSessionEntries.length >= maxSessions) {
        const error = new Error(`Journal recovery exceeds maxSessions while scanning ${directory}`)
        error.code = "JOURNAL_RECOVERY_LIMIT_EXCEEDED"
        error.details = { maxSessions }
        throw error
      }
      validSessionEntries.push(entry)
    }

    validSessionEntries.sort((left, right) => {
      const timestampOrder = left.name.slice(0, 19).localeCompare(right.name.slice(0, 19))
      if (timestampOrder !== 0) return timestampOrder

      const leftSuffix = left.name.slice(19, -6)
      const rightSuffix = right.name.slice(19, -6)
      const leftIndex = BigInt(leftSuffix.slice(1) || "0")
      const rightIndex = BigInt(rightSuffix.slice(1) || "0")

      if (leftIndex !== rightIndex) return leftIndex < rightIndex ? -1 : 1
      if (leftSuffix === rightSuffix) return 0
      return leftSuffix < rightSuffix ? -1 : 1
    })

    const records = []
    const recordIds = new Set()
    const sessions = []
    let bytesRead = 0
    for (const entry of validSessionEntries) {
      const fileStats = await store.statSession(entry.name)
      if (bytesRead + fileStats.size > maxBytes) {
        const error = new Error(`Journal recovery exceeds maxBytes while reading ${entry.name}`)
        error.code = "JOURNAL_RECOVERY_LIMIT_EXCEEDED"
        error.details = { maxBytes, bytesRead, nextFileBytes: fileStats.size }
        throw error
      }

      const contentBuffer = await store.readSession(entry.name)
      const fileBytes = contentBuffer.byteLength
      let content
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(contentBuffer)
      } catch (cause) {
        const error = new Error(`Journal session ${entry.name} is not valid UTF-8`)
        error.code = "JOURNAL_INVALID_ENCODING"
        error.details = { fileName: entry.name, cause }
        throw error
      }
      bytesRead += fileBytes
      if (bytesRead > maxBytes) {
        const error = new Error(`Journal recovery exceeds maxBytes while reading ${entry.name}`)
        error.code = "JOURNAL_RECOVERY_LIMIT_EXCEEDED"
        error.details = { maxBytes, bytesRead }
        throw error
      }

      const sessionRecords = parseJournalSession({
        content,
        fileName: entry.name,
        maxRecordBytes,
      })

      if (records.length + sessionRecords.length > maxRecords) {
        const error = new Error(`Journal recovery exceeds maxRecords while reading ${entry.name}`)
        error.code = "JOURNAL_RECOVERY_LIMIT_EXCEEDED"
        error.details = { maxRecords, recordsRead: records.length, nextSessionRecords: sessionRecords.length }
        throw error
      }

      for (const record of sessionRecords) {
        if (recordIds.has(record.id)) {
          const error = new Error(`Duplicate journal record id ${record.id} at ${entry.name}:${record.position.lineNumber}`)
          error.code = "JOURNAL_DUPLICATE_RECORD_ID"
          error.details = { ...record.position, recordId: record.id }
          throw error
        }
        recordIds.add(record.id)
        records.push(record)
      }
      sessions.push(entry.name)
    }

    return toResult({ records, count: records.length, sessions, bytesRead })
  } catch (error) {
    return toResult({ error })
  }
}
