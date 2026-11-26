import { decodeBsonDocument, encodeBsonDocument } from "./bson.js"

const HEADER_SIZE = 16
const OP_MSG = 2013
const MAX_WIRE_MESSAGE_SIZE = 48 * 1024 * 1024
const CHECKSUM_PRESENT = 1
const MORE_TO_COME = 2
const SUPPORTED_FLAGS = MORE_TO_COME

function validateMessageIdentifier({ value, label }) {
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) {
    throw new TypeError(`${label} must be a non-negative 31-bit integer`)
  }
}

function encodeDocumentSequence({ identifier, documents }) {
  if (typeof identifier !== "string" || identifier.length === 0 || identifier.includes("\0") || !identifier.isWellFormed()) {
    throw new TypeError("MongoDB document sequence identifier must be a non-empty cstring")
  }
  if (!Array.isArray(documents)) {
    throw new TypeError("MongoDB document sequence documents must be an array")
  }
  const encodedDocuments = documents.map(encodeBsonDocument)
  const name = Buffer.from(`${identifier  }\0`, "utf8")
  let size = 4 + name.length
  for (const document of encodedDocuments) {
    size += document.length
  }
  const section = Buffer.allocUnsafe(size)
  section.writeInt32LE(size, 0)
  let offset = 4
  name.copy(section, offset)
  offset += name.length
  for (const document of encodedDocuments) {
    document.copy(section, offset)
    offset += document.length
  }
  return Buffer.concat([Buffer.from([1]), section])
}

/** Encode a MongoDB OP_MSG request or response. */
export function encodeOpMsg({ requestId, responseTo = 0, flags = 0, body, sequences = [] }) {
  validateMessageIdentifier({ value: requestId,
label: "requestId" })
  validateMessageIdentifier({ value: responseTo,
label: "responseTo" })
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xffffffff || (flags & ~SUPPORTED_FLAGS) !== 0) {
    throw new TypeError("MongoDB OP_MSG contains unsupported flag bits")
  }
  if (!Array.isArray(sequences)) {
    throw new TypeError("MongoDB OP_MSG sequences must be an array")
  }
  const bodySection = Buffer.concat([
    Buffer.from([0]),
    encodeBsonDocument(body),
  ])
  const sequenceSections = sequences.map(encodeDocumentSequence)
  const payload = Buffer.concat([bodySection, ...sequenceSections])
  const length = HEADER_SIZE + 4 + payload.length
  if (length > MAX_WIRE_MESSAGE_SIZE) {
    throw new TypeError("MongoDB wire message exceeds the 48 MiB message limit")
  }
  const message = Buffer.allocUnsafe(length)
  message.writeInt32LE(length, 0)
  message.writeInt32LE(requestId, 4)
  message.writeInt32LE(responseTo, 8)
  message.writeInt32LE(OP_MSG, 12)
  message.writeUInt32LE(flags, 16)
  payload.copy(message, 20)
  return message
}

function readSequence({ buffer, state }) {
  if (state.offset + 4 > state.end) {
    throw new TypeError("Truncated MongoDB document sequence size")
  }
  const start = state.offset
  const size = buffer.readInt32LE(start)
  if (size < 5 || start + size > state.end) {
    throw new TypeError("Invalid MongoDB document sequence size")
  }
  const end = start + size
  const nameEnd = buffer.indexOf(0, start + 4)
  if (nameEnd < 0 || nameEnd >= end) {
    throw new TypeError("Invalid MongoDB document sequence identifier")
  }
  const identifierBytes = buffer.subarray(start + 4, nameEnd)
  const identifier = identifierBytes.toString("utf8")
  if (!Buffer.from(identifier, "utf8").equals(identifierBytes)) {
    throw new TypeError("MongoDB document sequence identifier contains invalid UTF-8")
  }
  if (!identifier) {
    throw new TypeError("MongoDB document sequence identifier must not be empty")
  }
  const documents = []
  state.offset = nameEnd + 1
  while (state.offset < end) {
    if (state.offset + 4 > end) {
      throw new TypeError("Truncated BSON document in MongoDB sequence")
    }
    const documentLength = buffer.readInt32LE(state.offset)
    if (documentLength < 5 || state.offset + documentLength > end) {
      throw new TypeError("Invalid BSON document in MongoDB sequence")
    }
    const document = decodeBsonDocument(
      buffer.subarray(state.offset, state.offset + documentLength),
    )
    documents.push(document)
    state.offset += documentLength
  }
  if (state.offset !== end) {
    throw new TypeError("MongoDB document sequence length mismatch")
  }
  return { identifier,
documents }
}

/** Decode one complete MongoDB OP_MSG frame. */
export function decodeOpMsg(message) {
  if (!Buffer.isBuffer(message) || message.length < HEADER_SIZE + 10) {
    throw new TypeError("MongoDB OP_MSG frame is truncated")
  }
  const length = message.readInt32LE(0)
  if (length !== message.length || length > MAX_WIRE_MESSAGE_SIZE) {
    throw new TypeError("MongoDB OP_MSG frame length is invalid")
  }
  const opcode = message.readInt32LE(12)
  if (opcode !== OP_MSG) {
    throw new TypeError(`Unsupported MongoDB wire opcode ${opcode}`)
  }
  const flags = message.readUInt32LE(16)
  if ((flags & CHECKSUM_PRESENT) !== 0) {
    throw new TypeError("MongoDB OP_MSG checksums are not supported")
  }
  if ((flags & ~SUPPORTED_FLAGS) !== 0) {
    throw new TypeError("MongoDB OP_MSG contains unsupported flag bits")
  }
  const state = { offset: 20,
end: message.length }
  let body
  const sequences = Object.create(null)
  while (state.offset < state.end) {
    const kind = message[state.offset]
    state.offset += 1
    if (kind === 0) {
      if (state.offset + 4 > state.end) {
        throw new TypeError("Truncated BSON body in MongoDB OP_MSG")
      }
      if (body !== undefined) {
        throw new TypeError("MongoDB OP_MSG must contain exactly one body section")
      }
      const documentLength = message.readInt32LE(state.offset)
      if (documentLength < 5 || state.offset + documentLength > state.end) {
        throw new TypeError("Invalid BSON body in MongoDB OP_MSG")
      }
      body = decodeBsonDocument(
        message.subarray(state.offset, state.offset + documentLength),
      )
      state.offset += documentLength
      continue
    }
    if (kind === 1) {
      if (body === undefined) {
        throw new TypeError("MongoDB OP_MSG body section must precede document sequences")
      }
      const sequence = readSequence({ buffer: message,
state })
      if (Object.hasOwn(sequences, sequence.identifier)) {
        throw new TypeError("MongoDB OP_MSG contains a duplicate sequence identifier")
      }
      sequences[sequence.identifier] = sequence.documents
      continue
    }
    throw new TypeError(`Unsupported MongoDB OP_MSG section kind ${kind}`)
  }
  if (body === undefined) {
    throw new TypeError("MongoDB OP_MSG is missing its body section")
  }
  const requestId = message.readInt32LE(4)
  const responseTo = message.readInt32LE(8)
  validateMessageIdentifier({ value: requestId,
label: "requestId" })
  validateMessageIdentifier({ value: responseTo,
label: "responseTo" })
  return {
    requestId,
    responseTo,
    flags,
    body,
    sequences,
  }
}
