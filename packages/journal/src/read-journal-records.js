import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

import { toResult } from "@coinzilla/utils"
import { parseJournalSession } from "./helpers/journal-record.js"

const DEFAULT_LIMITS = Object.freeze({
  maxRecords: 100_000,
  maxBytes: 64 * 1024 * 1024,
  maxRecordBytes: 1024 * 1024,
})
const SESSION_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+)?\.jsonl$/

function validateReadOptions({ directory, maxRecords, maxBytes, maxRecordBytes }) {
  if (typeof directory !== "string" || directory.trim() === "") {
    return toResult({ error: new TypeError("A journal directory is required") })
  }
  for (const [name, value] of Object.entries({ maxRecords, maxBytes, maxRecordBytes })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      return toResult({ error: new TypeError(`${name} must be a positive safe integer`) })
    }
  }
  return toResult({ valid: true })
}

/**
 * Read and validate all sessions in deterministic filename/line order.
 * The configured record and byte limits bound recovery memory and I/O.
 * @param {{ directory: string, maxRecords?: number, maxBytes?: number, maxRecordBytes?: number }} input
 */
export async function readJournalRecords({
  directory,
  maxRecords = DEFAULT_LIMITS.maxRecords,
  maxBytes = DEFAULT_LIMITS.maxBytes,
  maxRecordBytes = DEFAULT_LIMITS.maxRecordBytes,
} = {}) {
  const optionsResult = validateReadOptions({ directory, maxRecords, maxBytes, maxRecordBytes })
  if (!optionsResult.ok) return optionsResult

  try {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error.code === "ENOENT") {
        return toResult({ records: [], count: 0, sessions: [], bytesRead: 0 })
      }
      throw error
    }

    const sessionEntries = entries.filter((entry) => entry.name.endsWith(".jsonl"))
    for (const entry of sessionEntries) {
      if (!entry.isFile() || !SESSION_FILE_PATTERN.test(entry.name)) {
        const error = new Error(`Invalid journal session file entry: ${entry.name}`)
        error.code = "JOURNAL_INVALID_SESSION_FILE"
        throw error
      }
    }

    sessionEntries.sort((left, right) => {
      const timestampOrder = left.name.slice(0, 19).localeCompare(right.name.slice(0, 19))
      if (timestampOrder !== 0) return timestampOrder
      const leftSuffix = left.name.slice(19, -6)
      const rightSuffix = right.name.slice(19, -6)
      return Number(leftSuffix.slice(1) || 0) - Number(rightSuffix.slice(1) || 0)
    })

    const records = []
    const recordIds = new Set()
    const sessions = []
    let bytesRead = 0

    for (const entry of sessionEntries) {
      const filePath = path.join(directory, entry.name)
      const fileStats = await stat(filePath)
      if (bytesRead + fileStats.size > maxBytes) {
        const error = new Error(`Journal recovery exceeds maxBytes while reading ${entry.name}`)
        error.code = "JOURNAL_RECOVERY_LIMIT_EXCEEDED"
        error.details = { maxBytes, bytesRead, nextFileBytes: fileStats.size }
        throw error
      }

      const content = await readFile(filePath, "utf8")
      const fileBytes = Buffer.byteLength(content, "utf8")
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
