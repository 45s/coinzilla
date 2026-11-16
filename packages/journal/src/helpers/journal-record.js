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

function assertLosslessJsonValue({ value, path = "$", ancestors = new WeakSet() }) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return
  }

  if (typeof value === "number") {
    assertFiniteJsonNumber({ value,
path })
    return
  }

  if (typeof value !== "object") {
    throw new TypeError(`Journal source event contains unsupported ${typeof value} at ${path}`)
  }

  assertAcyclicJsonValue({ value,
path,
ancestors })
  assertSupportedJsonPrototype({ value,
path })

  ancestors.add(value)
  try {
    const keys = Reflect.ownKeys(value)
    assertJsonProperties({ value,
path,
ancestors,
keys })
    assertDenseJsonArray({ value,
path,
keys })
  } finally {
    // A repeated reference is valid and is serialized as a second subtree.
    // Only references on the active recursion path represent a cycle.
    ancestors.delete(value)
  }
}

function assertFiniteJsonNumber({ value, path }) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Journal source event contains a non-finite number at ${path}`)
  }
  if (Object.is(value, -0)) {
    throw new TypeError(`Journal source event contains negative zero at ${path}`)
  }
}

function assertAcyclicJsonValue({ value, path, ancestors }) {
  if (ancestors.has(value)) {
    throw new TypeError(`Journal source event contains a cyclic reference at ${path}`)
  }
}

function assertSupportedJsonPrototype({ value, path }) {
  const isArray = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  const hasSupportedPrototype = isArray
    ? prototype === Array.prototype
    : prototype === Object.prototype || prototype === null

  if (!hasSupportedPrototype) {
    throw new TypeError(`Journal source event contains a custom prototype at ${path}`)
  }
}

function assertJsonProperties({ value, path, ancestors, keys }) {
  const isArray = Array.isArray(value)

  for (const key of keys) {
    if (typeof key !== "string") {
      throw new TypeError(`Journal source event contains a symbol property at ${path}`)
    }
    if (isArray && key === "length") {
      continue
    }

    const propertyPath = isArray ? `${path}[${key}]` : `${path}[${JSON.stringify(key)}]`
    assertJsonProperty({ value,
key,
path: propertyPath,
ancestors,
isArray })
  }
}

function assertJsonProperty({ value, key, path, ancestors, isArray }) {
  if (isArray && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) {
    throw new TypeError(`Journal source event array contains a custom property at ${path}`)
  }

  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !Object.hasOwn(descriptor, "value")) {
    throw new TypeError(`Journal source event contains an accessor property at ${path}`)
  }
  if (!descriptor.enumerable) {
    throw new TypeError(`Journal source event contains a non-enumerable property at ${path}`)
  }
  if (key === "toJSON" && typeof descriptor.value === "function") {
    throw new TypeError(`Journal source event contains a custom toJSON hook at ${path}`)
  }

  assertLosslessJsonValue({ value: descriptor.value,
path,
ancestors })
}

function assertDenseJsonArray({ value, path, keys }) {
  // JSON.stringify silently converts holes to null; reject sparse arrays before writing.
  if (Array.isArray(value) && keys.length !== value.length + 1) {
    throw new TypeError(`Journal source event contains a sparse array at ${path}`)
  }
}

/**
 * Serialize a stable source event with additive versioned journal metadata.
 * The complete source-event graph is validated before copying or JSON serialization.
 * Shared-reference identity is outside the persisted contract; repeated references
 * are serialized as repeated subtrees.
 * @param {{ event: object }} input
 * @returns {string}
 * @throws {TypeError} If the event or any nested value cannot be represented losslessly in JSONL.
 */
export function serializeJournalRecord({ event } = {}) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("A valid event object is required")
  }

  const idDescriptor = Object.getOwnPropertyDescriptor(event, "id")
  if (
    !idDescriptor ||
    !Object.hasOwn(idDescriptor, "value") ||
    !isValidJournalRecordId(idDescriptor.value)
  ) {
    throw new TypeError("Journal events require a non-empty stable id")
  }

  if (Object.hasOwn(event, JOURNAL_METADATA_KEY)) {
    throw new TypeError(`Event field ${JOURNAL_METADATA_KEY} is reserved by Journal`)
  }

  assertLosslessJsonValue({ value: event })

  // The recursive validator rejects accessors and custom prototypes before this copy.
  const record = { ...event }

  // Keep event fields at the JSONL top level for existing consumers that
  // inspect persisted events directly; the metadata is additive.
  Object.assign(record, {
    [JOURNAL_METADATA_KEY]: {
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      id: idDescriptor.value,
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
function parseJournalLine({ line, fileName, lineNumber, maxRecordBytes }) {
  const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line
  const position = {
    fileName,
    lineNumber,
  }

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
      details: {
        ...position,
        maxRecordBytes,
      },
    })
  }

  let parsed
  try {
    parsed = JSON.parse(normalizedLine)
  } catch (cause) {
    throw createJournalError({
      code: "JOURNAL_MALFORMED_RECORD",
      message: `Journal session ${fileName} contains invalid JSON at line ${lineNumber}: ${cause.message}`,
      details: {
        ...position,
        cause,
      },
    })
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw createJournalError({
      code: "JOURNAL_MALFORMED_RECORD",
      message: `Journal record at ${fileName}:${lineNumber} must be an object`,
      details: position,
    })
  }

  return normalizeJournalRecord({
    parsed,
    fileName,
    lineNumber,
  })
}

function normalizeJournalRecord({ parsed, fileName, lineNumber }) {
  const position = {
    fileName,
    lineNumber,
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
    ({ schemaVersion, id } = metadata)
    payload = { ...parsed }
    delete payload[JOURNAL_METADATA_KEY]

    if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      throw createJournalError({
        code: "JOURNAL_UNSUPPORTED_SCHEMA_VERSION",
        message: `Unsupported journal schema version ${String(schemaVersion)} at ${fileName}:${lineNumber}`,
        details: {
          ...position,
          schemaVersion,
          supportedSchemaVersion: SUPPORTED_SCHEMA_VERSION,
        },
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
    ({ id } = parsed)
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

  return {
    id,
    schemaVersion,
    payload,
    position,
  }
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
  if (content === "") {
    return []
  }
  if (!content.endsWith("\n")) {
    throw createJournalError({
      code: "JOURNAL_INCOMPLETE_RECORD",
      message: `Journal session ${fileName} ends with an incomplete record`,
      details: {
        fileName,
        lineNumber: content.split("\n").length,
      },
    })
  }

  const lines = content.slice(0, -1).split("\n")
  return lines.map((...lineArguments) => {
    const [line, index] = lineArguments
    return parseJournalLine({
      line,
      fileName,
      lineNumber: index + 1,
      maxRecordBytes,
    })
  })
}
