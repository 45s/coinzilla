import assert from "node:assert/strict"
import test from "node:test"

import { decodeOpMsg, encodeOpMsg } from "./wire-protocol.js"
import { encodeBsonDocument } from "./bson.js"

test("OP_MSG encodes a BSON body with the exact MongoDB message header", () => {
  const message = encodeOpMsg({
    requestId: 17,
    body: { ping: 1,
$db: "admin" },
  })

  assert.equal(message.readInt32LE(0), message.length)
  assert.equal(message.readInt32LE(4), 17)
  assert.equal(message.readInt32LE(8), 0)
  assert.equal(message.readInt32LE(12), 2013)

  const decoded = decodeOpMsg(message)
  assert.equal(decoded.requestId, 17)
  assert.equal(decoded.responseTo, 0)
  assert.deepEqual(decoded.body, { ping: 1,
$db: "admin" })
})

test("OP_MSG preserves response correlation, flags, and document sequences", () => {
  const message = encodeOpMsg({
    requestId: 22,
    responseTo: 17,
    flags: 2,
    body: { insert: "records",
$db: "app" },
    sequences: [{
      identifier: "documents",
      documents: [{ _id: "one" }, { _id: "two" }],
    }],
  })

  const decoded = decodeOpMsg(message)

  assert.equal(decoded.responseTo, 17)
  assert.equal(decoded.flags, 2)
  assert.deepEqual({ ...decoded.sequences }, {
    documents: [{ _id: "one" }, { _id: "two" }],
  })
})

test("OP_MSG rejects truncated, oversized, and unsupported messages", () => {
  const message = encodeOpMsg({
    requestId: 1,
    body: { ping: 1 },
  })

  assert.throws(
    () => decodeOpMsg(message.subarray(0, 10)),
    TypeError,
  )

  const badLength = Buffer.from(message)
  badLength.writeInt32LE(message.length + 1, 0)
  assert.throws(() => decodeOpMsg(badLength), TypeError)

  const badOpcode = Buffer.from(message)
  badOpcode.writeInt32LE(1, 12)
  assert.throws(() => decodeOpMsg(badOpcode), TypeError)
})



function createFrame({ payload, flags = 0 }) {
  const message = Buffer.alloc(20 + payload.length)
  message.writeInt32LE(message.length, 0)
  message.writeInt32LE(1, 4)
  message.writeInt32LE(0, 8)
  message.writeInt32LE(2013, 12)
  message.writeUInt32LE(flags, 16)
  payload.copy(message, 20)
  return message
}

test("OP_MSG rejects invalid identifiers, duplicate sections, and unsupported response flags", () => {
  const bodySection = Buffer.concat([
    Buffer.from([0]),
    encodeBsonDocument({ ping: 1 }),
  ])
  const encoded = encodeOpMsg({
    requestId: 1,
    body: { ping: 1 },
  })

  const invalidRequestId = Buffer.from(encoded)
  invalidRequestId.writeInt32LE(-1, 4)
  assert.throws(() => decodeOpMsg(invalidRequestId), /requestId/)

  const checksum = Buffer.from(encoded)
  checksum.writeUInt32LE(1, 16)
  assert.throws(() => decodeOpMsg(checksum), /checksums/)

  assert.throws(
    () => decodeOpMsg(createFrame({ payload: Buffer.concat([bodySection, bodySection]) })),
    /exactly one body section/,
  )
  assert.throws(
    () => decodeOpMsg(createFrame({ payload: Buffer.from([2, 0, 0, 0, 0, 0]) })),
    /section kind/,
  )
})

test("OP_MSG requires the body before document sequences and rejects duplicate sequence identifiers", () => {
  const withSequence = encodeOpMsg({
    requestId: 1,
    body: { insert: "records" },
    sequences: [{ identifier: "documents",
documents: [{ _id: "one" }] }],
  })
  const bodyLength = encodeBsonDocument({ insert: "records" }).length
  const sequenceSection = withSequence.subarray(21 + bodyLength)

  assert.throws(
    () => decodeOpMsg(createFrame({ payload: Buffer.concat([
      sequenceSection,
      Buffer.from([0]),
      encodeBsonDocument({ insert: "records" }),
    ]) })),
    /body section must precede/,
  )

  assert.throws(
    () => decodeOpMsg(encodeOpMsg({
      requestId: 2,
      body: { insert: "records" },
      sequences: [
        { identifier: "documents",
documents: [] },
        { identifier: "documents",
documents: [] },
      ],
    })),
    /duplicate sequence identifier/,
  )
})

test("OP_MSG sequence identifiers cannot mutate the sequence map prototype", () => {
  const message = encodeOpMsg({
    requestId: 2,
    responseTo: 1,
    body: { ok: 1 },
    sequences: [{
      identifier: "__proto__",
      documents: [{ value: "safe" }],
    }],
  })

  const decoded = decodeOpMsg(message)

  assert.equal(Object.getPrototypeOf(decoded.sequences), null)
  assert.equal(Object.hasOwn(decoded.sequences, "__proto__"), true)
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(decoded.sequences, "__proto__")?.value,
    [{ value: "safe" }],
  )
})

test("OP_MSG rejects malformed sequence lengths and invalid request options", () => {
  const withSequence = encodeOpMsg({
    requestId: 1,
    body: { insert: "records" },
    sequences: [{ identifier: "documents",
documents: [] }],
  })
  const malformedSequence = Buffer.from(withSequence)
  malformedSequence.writeInt32LE(4, 21 + encodeBsonDocument({ insert: "records" }).length + 1)

  assert.throws(() => decodeOpMsg(malformedSequence), /sequence size/)

  assert.throws(
    () => encodeOpMsg({ requestId: -1,
body: { ping: 1 } }),
    /requestId/,
  )
  assert.throws(
    () => encodeOpMsg({ requestId: 1,
responseTo: -1,
body: { ping: 1 } }),
    /responseTo/,
  )
  assert.throws(
    () => encodeOpMsg({ requestId: 1,
body: { ping: 1 },
sequences: {} }),
    /sequences must be an array/,
  )
  assert.throws(
    () => encodeOpMsg({
      requestId: 1,
      body: { ping: 1 },
      sequences: [{ identifier: "bad\u0000name",
documents: [] }],
    }),
    /identifier/,
  )
})

test("OP_MSG rejects unknown required flag bits", () => {
  assert.throws(
    () => encodeOpMsg({
      requestId: 3,
      flags: 4,
      body: { ping: 1 },
    }),
    /unsupported.*flag/i,
  )
})
test("MongoDB OP_MSG encoder rejects invalid sequences and configured size limits", () => {
  assert.throws(
    () => encodeOpMsg({
      requestId: 1,
      body: { ping: 1 },
      sequences: "not-an-array",
    }),
    /sequence documents must be an array/,
  )
  assert.throws(
    () => encodeOpMsg({
      requestId: 1,
      body: { ping: 1 },
      maxMessageSize: 25,
    }),
    /48 MiB message limit/,
  )
})

test("MongoDB OP_MSG decoder rejects malformed document sequence boundaries and identifiers", () => {
  assert.throws(
    () => decodeOpMsg(createFrame({ payload: Buffer.from([1]) })),
    /Truncated MongoDB document sequence size/,
  )

  const invalidIdentifier = Buffer.from([1, 7, 0, 0, 0, 0x61, 0x62, 0x63])
  assert.throws(
    () => decodeOpMsg(createFrame({ payload: invalidIdentifier })),
    /Invalid MongoDB document sequence identifier/,
  )

  const invalidUtf8 = Buffer.from([1, 6, 0, 0, 0, 0xff, 0])
  assert.throws(
    () => decodeOpMsg(createFrame({ payload: invalidUtf8 })),
    /invalid UTF-8/,
  )

  const emptyIdentifier = Buffer.from([1, 5, 0, 0, 0, 0])
  assert.throws(
    () => decodeOpMsg(createFrame({ payload: emptyIdentifier })),
    /must not be empty/,
  )

  const truncatedDocument = Buffer.from([1, 7, 0, 0, 0, 0x78, 0, 0xaa])
  assert.throws(
    () => decodeOpMsg(createFrame({ payload: truncatedDocument })),
    /Truncated BSON document/,
  )

  const invalidDocumentLength = Buffer.from([1, 10, 0, 0, 0, 0x78, 0, 4, 0, 0, 0])
  assert.throws(
    () => decodeOpMsg(createFrame({ payload: invalidDocumentLength })),
    /Invalid BSON document/,
  )
})

test("MongoDB OP_MSG decoder rejects unsupported flags and malformed body sections", () => {
  const body = Buffer.concat([Buffer.from([0]), encodeBsonDocument({ ok: 1 })])
  assert.throws(
    () => decodeOpMsg(createFrame({ payload: body,
flags: 0x80000000 })),
    /unsupported flag bits/,
  )
  assert.throws(
    () => decodeOpMsg(createFrame({ payload: Buffer.from([0, 0, 0, 0]) })),
    /Truncated BSON body/,
  )
  assert.throws(
    () => decodeOpMsg(createFrame({ payload: Buffer.from([0, 4, 0, 0, 0]) })),
    /Invalid BSON body/,
  )
})

