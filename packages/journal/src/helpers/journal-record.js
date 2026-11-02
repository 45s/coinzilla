const JOURNAL_METADATA_KEY = "__coinzillaJournal"
const SUPPORTED_SCHEMA_VERSION = 1

function createJournalError({ code, message, details = {} }) {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

/**
 * Serialize a stable, versioned journal envelope.
 * @param {{ event: object }} input
 * @returns {string}
 */
export function serializeJournalRecord({ event } = {}) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("A valid event object is required")
  }
  if (typeof event.id !== "string" || event.id.trim() === "") {
    throw new TypeError("Journal events require a non-empty stable id")
  }

  const envelope = {
    [JOURNAL_METADATA_KEY]: {
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      id: event.id,
    },
    payload: event,
  }

  return `${JSON.stringify(envelope)}\n`
}

/**
 * Parse one complete JSONL session. No partial or malformed record is ignored.
 * Legacy raw event records are interpreted as schema version 1.
 * @param {{ content: string, fileName: string, maxRecordBytes: number }} input
 * @returns {Array<{ id: string, schemaVersion: number, payload: object, position: object }>}
 */
export function parseJournalSession({ content, fileName, maxRecordBytes } = {}) {
  if (typeof content !== "string" || typeof fileName !== "string") {
    throw new TypeError("Journal session content and fileName are required")
  }
  if (!Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1) {
    throw new TypeError("maxRecordBytes must be a positive safe integer")
  }
  if (content === "") return []
  if (!content.endsWith("\n")) {
    throw createJournalError({
      code: "JOURNAL_INCOMPLETE_RECORD",
      message: `Journal session ${fileName} ends with an incomplete record`,
      details: { fileName, lineNumber: content.split("\n").length },
    })
  }

  const lines = content.slice(0, -1).split("\n")
  return lines.map((line, index) => {
    const lineNumber = index + 1
    const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line
    const position = { fileName, lineNumber }

    if (normalizedLine === "") {
      throw createJournalError({
        code: "JOURNAL_MALFORMED_RECORD",
        message: `Journal session ${fileName} contains an empty record at line ${lineNumber}`,
        details: position,
      })
    }
    if (Buffer.byteLength(normalizedLine, "utf8") > maxRecordBytes) {
      throw createJournalError({
        code: "JOURNAL_RECORD_TOO_LARGE",
        message: `Journal record at ${fileName}:${lineNumber} exceeds maxRecordBytes`,
        details: { ...position, maxRecordBytes },
      })
    }

    let parsed
    try {
      parsed = JSON.parse(normalizedLine)
    } catch (cause) {
      throw createJournalError({
        code: "JOURNAL_MALFORMED_RECORD",
        message: `Journal session ${fileName} contains invalid JSON at line ${lineNumber}: ${cause.message}`,
        details: { ...position, cause },
      })
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw createJournalError({
        code: "JOURNAL_MALFORMED_RECORD",
        message: `Journal record at ${fileName}:${lineNumber} must be an object`,
        details: position,
      })
    }

    let id
    let schemaVersion
    let payload

    if (Object.hasOwn(parsed, JOURNAL_METADATA_KEY)) {
      const metadata = parsed[JOURNAL_METADATA_KEY]
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw createJournalError({
          code: "JOURNAL_MALFORMED_RECORD",
          message: `Journal metadata at ${fileName}:${lineNumber} is invalid`,
          details: position,
        })
      }
      schemaVersion = metadata.schemaVersion
      id = metadata.id
      payload = parsed.payload

      if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
        throw createJournalError({
          code: "JOURNAL_UNSUPPORTED_SCHEMA_VERSION",
          message: `Unsupported journal schema version ${String(schemaVersion)} at ${fileName}:${lineNumber}`,
          details: { ...position, schemaVersion, supportedSchemaVersion: SUPPORTED_SCHEMA_VERSION },
        })
      }
      if (
        typeof id !== "string" ||
        id.trim() === "" ||
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        payload.id !== id
      ) {
        throw createJournalError({
          code: "JOURNAL_MALFORMED_RECORD",
          message: `Journal envelope at ${fileName}:${lineNumber} has invalid identity or payload`,
          details: position,
        })
      }
    } else {
      // Existing JSONL sessions predate the versioned envelope.
      id = parsed.id
      schemaVersion = SUPPORTED_SCHEMA_VERSION
      payload = parsed
      if (typeof id !== "string" || id.trim() === "") {
        throw createJournalError({
          code: "JOURNAL_MALFORMED_RECORD",
          message: `Legacy journal record at ${fileName}:${lineNumber} has no stable id`,
          details: position,
        })
      }
    }

    return { id, schemaVersion, payload, position }
  })
}
