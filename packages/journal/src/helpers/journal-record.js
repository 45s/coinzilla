const JOURNAL_METADATA_KEY = "__coinzillaJournal"
const SUPPORTED_SCHEMA_VERSION = 1

function isValidJournalRecordId(value) {
  return typeof value === "string" && value.trim() !== ""
}

function createJournalError({ code, message, details = {} }) {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

/**
 * Serialize a stable source event with additive versioned journal metadata.
 * Source events must not provide Journal's reserved metadata or a root toJSON hook.
 * @remarks Uses JSON.stringify and currently validates only the top-level record envelope.
 * Callers must provide acyclic, losslessly JSON-safe plain data; nested undefined,
 * non-finite numbers, and negative zero may be omitted or coerced, while BigInt and
 * cycles throw. Shared-reference identity is not preserved. See Journal issue #889.
 * @param {{ event: object }} input
 * @returns {string}
 * @throws {TypeError} If the event shape, stable identity, or reserved-field contract is invalid.
 */
export function serializeJournalRecord({ event } = {}) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("A valid event object is required")
  }
  if (!isValidJournalRecordId(event.id)) {
    throw new TypeError("Journal events require a non-empty stable id")
  }

  if (Object.hasOwn(event, JOURNAL_METADATA_KEY)) {
    throw new TypeError(`Event field ${JOURNAL_METADATA_KEY} is reserved by Journal`)
  }

  // A copied root toJSON hook could replace the whole envelope during stringify.
  const record = { ...event }
  if (typeof record.toJSON === "function") {
    throw new TypeError("Journal source events cannot define an own enumerable toJSON function")
  }

  // Keep event fields at the JSONL top level for existing consumers that
  // inspect persisted events directly; the metadata is additive.
  Object.assign(record, {
    [JOURNAL_METADATA_KEY]: {
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      id: event.id,
    },
  })

  return `${JSON.stringify(record)}\n`
}

/**
 * Parse one complete JSONL session. No partial or malformed record is ignored.
 * Legacy raw event records without metadata are interpreted as schema version 1.
 * @param {{ content: string, fileName: string, maxRecordBytes: number }} input
 * @returns {Array<{ id: string, schemaVersion: number, payload: object, position: { fileName: string, lineNumber: number } }>}
 * @throws {TypeError|Error} If options are invalid or any line violates the record contract.
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
      payload = { ...parsed }
      delete payload[JOURNAL_METADATA_KEY]

      if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
        throw createJournalError({
          code: "JOURNAL_UNSUPPORTED_SCHEMA_VERSION",
          message: `Unsupported journal schema version ${String(schemaVersion)} at ${fileName}:${lineNumber}`,
          details: { ...position, schemaVersion, supportedSchemaVersion: SUPPORTED_SCHEMA_VERSION },
        })
      }
      if (
        !isValidJournalRecordId(id) ||
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        payload.id !== id
      ) {
        throw createJournalError({
          code: "JOURNAL_MALFORMED_RECORD",
          message: `Journal record metadata at ${fileName}:${lineNumber} has invalid identity or payload`,
          details: position,
        })
      }
    } else {
      // Existing JSONL sessions predate the additive metadata field.
      id = parsed.id
      schemaVersion = SUPPORTED_SCHEMA_VERSION
      payload = parsed
      if (!isValidJournalRecordId(id)) {
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
