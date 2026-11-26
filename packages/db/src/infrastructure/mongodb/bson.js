const MAX_BSON_DOCUMENT_SIZE = 16 * 1024 * 1024
const MAX_BSON_NESTING_DEPTH = 100
const INT32_MIN = -(2 ** 31)
const INT32_MAX = 2 ** 31 - 1
const INT64_MIN = -(2n ** 63n)
const INT64_MAX = (2n ** 63n) - 1n

export class BsonBinary {
  constructor({ bytes, subtype = 0 } = {}) {
    if (!Buffer.isBuffer(bytes) || ![0, 4].includes(subtype)) {
      throw new TypeError("BSON binary requires a Buffer and supported generic (0) or UUID (4) subtype")
    }
    if (subtype === 4 && bytes.length !== 16) {
      throw new TypeError("BSON UUID binary subtype 4 must contain exactly 16 bytes")
    }
    this.bytes = Buffer.from(bytes)
    this.subtype = subtype
    Object.freeze(this)
  }
}

function assertDocument({ value, ancestors }) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Buffer.isBuffer(value) || value instanceof Date) {
    throw new TypeError("BSON documents must be plain objects")
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("BSON documents must be plain objects")
  }
  if (ancestors.has(value)) {
    throw new TypeError("BSON documents must not contain circular references")
  }
}

function encodeCString(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("BSON document keys must be strings without null bytes")
  }
  if (!value.isWellFormed()) {
    throw new TypeError("BSON document keys must contain valid Unicode")
  }
  return Buffer.from(`${value  }\0`, "utf8")
}

function encodeString(value) {
  if (!value.isWellFormed()) {
    throw new TypeError("BSON strings must contain valid Unicode")
  }
  const bytes = Buffer.from(value, "utf8")
  const result = Buffer.allocUnsafe(4 + bytes.length + 1)
  result.writeInt32LE(bytes.length + 1, 0)
  bytes.copy(result, 4)
  result[result.length - 1] = 0
  return result
}

function encodeInt64(value) {
  const integer = typeof value === "bigint" ? value : BigInt(value)
  if (integer < INT64_MIN || integer > INT64_MAX) {
    throw new TypeError("BSON integer is outside the signed 64-bit range")
  }
  const result = Buffer.allocUnsafe(8)
  result.writeBigInt64LE(integer)
  return result
}

function encodeNumber(value) {
  if (!Number.isFinite(value)) {
    throw new TypeError("BSON numbers must be finite")
  }
  if (Number.isSafeInteger(value) && value >= INT32_MIN && value <= INT32_MAX) {
    const bytes = Buffer.allocUnsafe(4)
    bytes.writeInt32LE(value)
    return { type: 0x10,
bytes }
  }
  if (Number.isSafeInteger(value)) {
    return { type: 0x12,
bytes: encodeInt64(value) }
  }
  const bytes = Buffer.allocUnsafe(8)
  bytes.writeDoubleLE(value)
  return { type: 0x01,
bytes }
}

function encodeBinary(value) {
  const binary = value instanceof BsonBinary ? value : new BsonBinary({ bytes: value })
  const bytes = Buffer.allocUnsafe(5 + binary.bytes.length)
  bytes.writeInt32LE(binary.bytes.length, 0)
  bytes[4] = binary.subtype
  binary.bytes.copy(bytes, 5)
  return { type: 0x05,
bytes }
}

function encodeDate(value) {
  const timestamp = value.getTime()
  if (!Number.isFinite(timestamp)) {
    throw new TypeError("BSON dates must be valid")
  }
  return { type: 0x09,
bytes: encodeInt64(timestamp) }
}

function encodePrimitive(value) {
  if (value === null) {
    return { type: 0x0A,
bytes: Buffer.alloc(0) }
  }
  if (typeof value === "string") {
    return { type: 0x02,
bytes: encodeString(value) }
  }
  if (typeof value === "boolean") {
    return { type: 0x08,
bytes: Buffer.from([Number(value)]) }
  }
  if (typeof value === "number") {
    return encodeNumber(value)
  }
  if (typeof value === "bigint") {
    return { type: 0x12,
bytes: encodeInt64(value) }
  }
  if (Buffer.isBuffer(value) || value instanceof BsonBinary) {
    return encodeBinary(value)
  }
  if (value instanceof Date) {
    return encodeDate(value)
  }
  return null
}

function collectDocumentEntries({ document }) {
  const entries = []
  for (const key of Reflect.ownKeys(document)) {
    if (typeof key !== "string") {
      throw new TypeError("BSON document keys must be strings")
    }
    const descriptor = Object.getOwnPropertyDescriptor(document, key)
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("BSON documents must contain enumerable data properties")
    }
    entries.push([key, descriptor.value])
  }
  return entries
}

function encodeArrayElement({ value, ancestors, depth }) {
  if (ancestors.has(value)) {
    throw new TypeError("BSON documents must not contain circular references")
  }
  ancestors.add(value)
  const entries = []
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError("BSON arrays must not be sparse")
    }
    entries.push([String(index), value[index]])
  }
  const bytes = encodeDocumentEntries({ entries,
ancestors,
depth: depth + 1 })
  ancestors.delete(value)
  return { type: 0x04,
bytes }
}

function encodeObjectElement({ value, ancestors, depth }) {
  assertDocument({ value,
ancestors })
  ancestors.add(value)
  const entries = collectDocumentEntries({ document: value })
  const bytes = encodeDocumentEntries({ entries,
ancestors,
depth: depth + 1 })
  ancestors.delete(value)
  return { type: 0x03,
bytes }
}

function encodeElement({ value, ancestors, depth }) {
  const primitive = encodePrimitive(value)
  if (primitive !== null) {
    return primitive
  }
  return Array.isArray(value)
    ? encodeArrayElement({ value,
ancestors,
depth })
    : encodeObjectElement({ value,
ancestors,
depth })
}

function encodeDocumentEntries({ entries, ancestors, depth = 0 }) {
  if (depth > MAX_BSON_NESTING_DEPTH) {
    throw new TypeError("BSON document nesting depth exceeds the supported limit")
  }
  const elements = []
  for (const [key, value] of entries) {
    const element = encodeElement({ value,
ancestors,
depth })
    elements.push(Buffer.from([element.type]), encodeCString(key), element.bytes)
  }
  let size = 5
  for (const element of elements) {
    size += element.length
  }
  if (size > MAX_BSON_DOCUMENT_SIZE) {
    throw new TypeError("BSON document exceeds the 16 MiB document limit")
  }
  const result = Buffer.allocUnsafe(size)
  result.writeInt32LE(size, 0)
  let offset = 4
  for (const part of elements) {
    part.copy(result, offset)
    offset += part.length
  }
  result[offset] = 0
  return result
}

/**
 * Encode a plain document using the BSON subset needed by the database provider.
 * Supported values are JSON scalars/containers plus Buffer, Date and signed 64-bit integers.
 */
export function encodeBsonDocument(document) {
  const ancestors = new Set()
  assertDocument({ value: document,
ancestors })
  ancestors.add(document)
  const entries = collectDocumentEntries({ document })
  const result = encodeDocumentEntries({ entries,
ancestors,
depth: 0 })
  ancestors.delete(document)
  return result
}

function assertRange({ buffer, offset, length, end, label }) {
  if (!Number.isSafeInteger(length) || length < 0 || offset + length > end || offset + length > buffer.length) {
    throw new TypeError(`Invalid or truncated BSON ${label}`)
  }
}

function readCString({ buffer, state }) {
  const end = buffer.indexOf(0, state.offset)
  if (end < 0 || end >= state.end) {
    throw new TypeError("Invalid BSON cstring")
  }
  const bytes = buffer.subarray(state.offset, end)
  const value = bytes.toString("utf8")
  if (!Buffer.from(value, "utf8").equals(bytes)) {
    throw new TypeError("BSON cstring contains invalid UTF-8")
  }
  state.offset = end + 1
  return value
}

function readString({ buffer, state }) {
  assertRange({ buffer,
offset: state.offset,
length: 4,
end: state.end,
label: "string length" })
  const length = buffer.readInt32LE(state.offset)
  state.offset += 4
  if (length < 1) {
    throw new TypeError("Invalid BSON string length")
  }
  assertRange({ buffer,
offset: state.offset,
length,
end: state.end,
label: "string" })
  if (buffer[state.offset + length - 1] !== 0) {
    throw new TypeError("BSON string is missing its terminator")
  }
  const bytes = buffer.subarray(state.offset, state.offset + length - 1)
  const value = bytes.toString("utf8")
  if (!Buffer.from(value, "utf8").equals(bytes)) {
    throw new TypeError("BSON string contains invalid UTF-8")
  }
  state.offset += length
  return value
}

function readDocument({ buffer, state, asArray = false, depth = 0 }) {
  if (depth > MAX_BSON_NESTING_DEPTH) {
    throw new TypeError("BSON document nesting depth exceeds the supported limit")
  }
  assertRange({ buffer,
offset: state.offset,
length: 4,
end: state.end,
label: "document length" })
  const start = state.offset
  const length = buffer.readInt32LE(start)
  if (length < 5 || length > MAX_BSON_DOCUMENT_SIZE) {
    throw new TypeError("Invalid BSON document length")
  }
  assertRange({ buffer,
offset: start,
length,
end: state.end,
label: "document" })
  const end = start + length
  if (buffer[end - 1] !== 0) {
    throw new TypeError("BSON document is missing its terminator")
  }
  const document = {}
  const arrayValues = []
  state.offset += 4
  const childState = { offset: state.offset,
end: end - 1 }
  while (childState.offset < childState.end) {
    const type = buffer[childState.offset]
    childState.offset += 1
    const key = readCString({ buffer,
state: childState })
    const value = readValue({ buffer,
state: childState,
type,
depth })
    if (asArray) {
      const index = Number(key)
      if (!Number.isSafeInteger(index) || index < 0 || String(index) !== key || index !== arrayValues.length) {
        throw new TypeError("BSON array indexes must be contiguous and ordered")
      }
      arrayValues.push(value)
    } else {
      if (Object.hasOwn(document, key)) {
        throw new TypeError("BSON document contains a duplicate key")
      }
      Object.defineProperty(document, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
  }
  if (childState.offset !== end - 1) {
    throw new TypeError("BSON document elements exceed the declared length")
  }
  state.offset = end
  return asArray ? arrayValues : document
}

function readInt64({ buffer, state }) {
  assertRange({ buffer,
offset: state.offset,
length: 8,
end: state.end,
label: "int64" })
  const value = buffer.readBigInt64LE(state.offset)
  state.offset += 8
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value
}

function readUInt64({ buffer, state }) {
  assertRange({ buffer,
offset: state.offset,
length: 8,
end: state.end,
label: "uint64" })
  const value = buffer.readBigUInt64LE(state.offset)
  state.offset += 8
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value
}

function readValue({ buffer, state, type, depth }) {
  if (type === 0x01) {
    assertRange({ buffer,
offset: state.offset,
length: 8,
end: state.end,
label: "double" })
    const value = buffer.readDoubleLE(state.offset)
    state.offset += 8
    return value
  }
  if (type === 0x02) {
    return readString({ buffer,
state })
  }
  if (type === 0x03 || type === 0x04) {
    return readDocument({ buffer,
state,
asArray: type === 0x04,
depth: depth + 1 })
  }
  if (type === 0x05) {
    assertRange({ buffer,
offset: state.offset,
length: 5,
end: state.end,
label: "binary header" })
    const length = buffer.readInt32LE(state.offset)
    const subtype = buffer[state.offset + 4]
    state.offset += 5
    if (length < 0 || ![0, 4].includes(subtype)) {
      throw new TypeError("Unsupported BSON binary length or subtype")
    }
    assertRange({ buffer,
offset: state.offset,
length,
end: state.end,
label: "binary value" })
    const bytes = Buffer.from(buffer.subarray(state.offset, state.offset + length))
    state.offset += length
    return subtype === 0 ? bytes : new BsonBinary({ bytes,
subtype })
  }
  if (type === 0x07) {
    assertRange({ buffer,
offset: state.offset,
length: 12,
end: state.end,
label: "ObjectId" })
    const value = buffer.toString("hex", state.offset, state.offset + 12)
    state.offset += 12
    return value
  }
  if (type === 0x08) {
    assertRange({ buffer,
offset: state.offset,
length: 1,
end: state.end,
label: "boolean" })
    const value = buffer[state.offset]
    state.offset += 1
    if (value !== 0 && value !== 1) {
      throw new TypeError("Invalid BSON boolean")
    }
    return value === 1
  }
  if (type === 0x09) {
    const value = readInt64({ buffer,
state })
    return new Date(value)
  }
  if (type === 0x0A) {
    return null
  }
  if (type === 0x10) {
    assertRange({ buffer,
offset: state.offset,
length: 4,
end: state.end,
label: "int32" })
    const value = buffer.readInt32LE(state.offset)
    state.offset += 4
    return value
  }
  if (type === 0x11) {
    // BSON Timestamp is an unsigned 64-bit value, unlike BSON int64 and Date.
    return readUInt64({ buffer,
state })
  }
  if (type === 0x12) {
    return readInt64({ buffer,
state })
  }
  throw new TypeError(`Unsupported BSON element type 0x${type.toString(16)}`)
}

/** Decode one BSON document and reject trailing or malformed bytes. */
export function decodeBsonDocument(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("BSON input must be a Buffer")
  }
  const state = { offset: 0,
end: buffer.length }
  const document = readDocument({ buffer,
state })
  if (state.offset !== buffer.length) {
    throw new TypeError("BSON input contains trailing bytes")
  }
  return document
}
