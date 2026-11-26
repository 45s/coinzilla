import assert from "node:assert/strict"
import test from "node:test"

import { BsonBinary, decodeBsonDocument, encodeBsonDocument } from "./bson.js"

test("BSON round-trips JSON records and nested arrays without changing JSON types", () => {
  const record = {
    id: "record-1",
    name: "Ada",
    active: true,
    score: 12.5,
    nullable: null,
    nested: {
      tags: ["db", "mongodb"],
      enabled: false,
    },
    values: [1, 2, 3],
  }

  assert.deepEqual(
    decodeBsonDocument(encodeBsonDocument(record)),
    record,
  )
})

test("BSON uses integer encodings for safe integer values and preserves signed 64-bit values", () => {
  const document = {
    small: 42,
    negative: -42,
    large: 2 ** 40,
    minimum: -(2 ** 52),
  }

  assert.deepEqual(
    decodeBsonDocument(encodeBsonDocument(document)),
    document,
  )
})

test("BSON supports binary values and dates for protocol-internal command documents", () => {
  const document = {
    payload: Buffer.from([0, 1, 2, 255]),
    createdAt: new Date("2026-11-26T12:00:00.000Z"),
  }

  const decoded = decodeBsonDocument(encodeBsonDocument(document))

  assert.deepEqual(decoded.payload, document.payload)
  assert.equal(decoded.createdAt.getTime(), document.createdAt.getTime())
})


test("BSON binary values preserve standard UUID subtype 4 for logical sessions", () => {
  const binary = new BsonBinary({ bytes: Buffer.from("00112233445566778899aabbccddeeff", "hex"),
subtype: 4 })
  const decoded = decodeBsonDocument(encodeBsonDocument({ id: binary }))

  assert.equal(decoded.id.subtype, 4)
  assert.deepEqual(decoded.id.bytes, binary.bytes)
})

test("BSON rejects unsupported values, invalid document keys, and cyclic documents", () => {
  const circular = {}
  circular.self = circular

  for (const document of [
    { value: undefined },
    { value: Number.NaN },
    { "invalid\u0000key": true },
    circular,
  ]) {
    assert.throws(
      () => encodeBsonDocument(document),
      TypeError,
    )
  }
})


test("BSON rejects malformed Unicode rather than silently replacing record text", () => {
  assert.throws(
    () => encodeBsonDocument({ value: "\ud800" }),
    TypeError,
  )

  const encoded = encodeBsonDocument({ value: "valid" })
  encoded[15] = 0xff
  assert.throws(
    () => decodeBsonDocument(encoded),
    TypeError,
  )
})


test("BSON rejects documents deeper than the supported nesting limit", () => {
  const document = {}
  let current = document
  for (let index = 0; index < 101; index += 1) {
    current.child = {}
    current = current.child
  }

  assert.throws(
    () => encodeBsonDocument(document),
    /nesting depth/i,
  )
})


test("BSON rejects invalid booleans, sparse arrays, accessors, and unsupported binary subtypes", () => {
  const invalidBoolean = encodeBsonDocument({ active: true })
  invalidBoolean[12] = 2

  assert.throws(() => decodeBsonDocument(invalidBoolean), /Invalid BSON boolean/)

  const sparse = []
  sparse.length = 2
  sparse[1] = "value"
  assert.throws(() => encodeBsonDocument({ values: sparse }), /must not be sparse/)

  const accessor = {}
  Object.defineProperty(accessor, "value", {
    enumerable: true,
    get() {
      return "not a data property"
    },
  })
  assert.throws(() => encodeBsonDocument(accessor), /data properties/)

  assert.throws(
    () => new BsonBinary({ bytes: Buffer.from([1]),
subtype: 4 }),
    /exactly 16 bytes/,
  )
  assert.throws(
    () => new BsonBinary({ bytes: Buffer.from([1]),
subtype: 2 }),
    /subtype/,
  )
})

test("BSON rejects unsupported object prototypes, symbol keys, invalid dates, and oversized integers", () => {
  assert.throws(
    () => encodeBsonDocument(Object.create({ inherited: true })),
    /plain objects/,
  )
  assert.throws(
    () => encodeBsonDocument({ [Symbol("key")]: "value" }),
    /keys must be strings/,
  )
  assert.throws(
    () => encodeBsonDocument({ date: new Date(Number.NaN) }),
    /valid/,
  )
  assert.throws(
    () => encodeBsonDocument({ value: 2n ** 63n }),
    /signed 64-bit range/,
  )
})

test("BSON enforces the 16 MiB document limit and rejects trailing input bytes", () => {
  const oversized = { value: "x".repeat(16 * 1024 * 1024) }
  assert.throws(
    () => encodeBsonDocument(oversized),
    /16 MiB/,
  )

  const encoded = encodeBsonDocument({ value: "ok" })
  assert.throws(
    () => decodeBsonDocument(Buffer.concat([encoded, Buffer.from([0])])),
    /trailing bytes/,
  )
})


function rawBsonDocument(elements) {
  let size = 5
  for (const element of elements) {
    size += element.length
  }
  const document = Buffer.alloc(size)
  document.writeInt32LE(size, 0)
  let offset = 4
  for (const element of elements) {
    element.copy(document, offset)
    offset += element.length
  }
  document[offset] = 0
  return document
}

test("BSON decodes protocol ObjectId and timestamp values", () => {
  const objectId = Buffer.from("00112233445566778899aabb", "hex")
  const timestamp = Buffer.alloc(8)
  timestamp.writeBigUInt64LE(123456789n)
  const objectIdElement = Buffer.concat([
    Buffer.from([0x07]),
    Buffer.from("objectId\0"),
    objectId,
  ])
  const timestampElement = Buffer.concat([
    Buffer.from([0x11]),
    Buffer.from("timestamp\0"),
    timestamp,
  ])
  const decoded = decodeBsonDocument(rawBsonDocument([
    objectIdElement,
    timestampElement,
  ]))

  assert.equal(decoded.objectId, objectId.toString("hex"))
  assert.equal(decoded.timestamp, 123456789)
})

test("BSON timestamps preserve the full unsigned 64-bit range", () => {
  const timestamp = Buffer.alloc(8)
  const value = (1n << 63n) + 123n
  timestamp.writeBigUInt64LE(value)
  const timestampElement = Buffer.concat([
    Buffer.from([0x11]),
    Buffer.from("timestamp\0"),
    timestamp,
  ])

  const decoded = decodeBsonDocument(rawBsonDocument([timestampElement]))

  assert.equal(decoded.timestamp, value)
})

test("BSON decoder rejects duplicate keys, invalid array indexes, and unsupported types", () => {
  const int32 = ({ key, value }) => {
    const payload = Buffer.alloc(4)
    payload.writeInt32LE(value)
    return Buffer.concat([Buffer.from([0x10]), Buffer.from(`${key}\0`), payload])
  }
  assert.throws(
    () => decodeBsonDocument(rawBsonDocument([
      int32({ key: "duplicate",
value: 1 }),
      int32({ key: "duplicate",
value: 2 }),
    ])),
    /duplicate key/,
  )

  const invalidArray = rawBsonDocument([int32({ key: "1",
value: 1 })])
  const arrayElement = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from("values\0"),
    invalidArray,
  ])
  assert.throws(
    () => decodeBsonDocument(rawBsonDocument([arrayElement])),
    /array indexes/,
  )

  assert.throws(
    () => decodeBsonDocument(rawBsonDocument([
      Buffer.concat([Buffer.from([0xff]), Buffer.from("unknown\0")]),
    ])),
    /Unsupported BSON element type/,
  )
})

test("BSON decoder rejects invalid UTF-8 in cstring keys", () => {
  const malformed = rawBsonDocument([
    Buffer.concat([Buffer.from([0x10, 0xff, 0x00]), Buffer.from([1, 0, 0, 0])]),
  ])
  assert.throws(
    () => decodeBsonDocument(malformed),
    /invalid UTF-8/,
  )
})

test("BSON decoder rejects truncated documents and inconsistent declared lengths", () => {
  const encoded = encodeBsonDocument({ value: "valid" })

  assert.throws(
    () => decodeBsonDocument(encoded.subarray(0, encoded.length - 1)),
    TypeError,
  )

  const invalidLength = Buffer.from(encoded)
  invalidLength.writeInt32LE(encoded.length + 10, 0)

  assert.throws(
    () => decodeBsonDocument(invalidLength),
    TypeError,
  )
})
function createNestedBsonDocument({ depth }) {
  let document = Buffer.from([5, 0, 0, 0, 0])
  for (let index = 0; index < depth; index += 1) {
    const element = Buffer.concat([Buffer.from([0x03, 0x78, 0]), document])
    const nested = Buffer.alloc(4 + element.length + 1)
    nested.writeInt32LE(nested.length, 0)
    element.copy(nested, 4)
    document = nested
  }
  return document
}

test("BSON encoder rejects invalid keys, circular values, non-finite numbers, and invalid dates", () => {
  assert.throws(
    () => encodeBsonDocument({ ["\uD800"]: 1 }),
    /valid Unicode/,
  )
  const circular = {}
  circular.self = circular
  assert.throws(() => encodeBsonDocument(circular), /circular references/)
  assert.throws(() => encodeBsonDocument({ value: Number.NaN }), /finite/)
  assert.throws(() => encodeBsonDocument({ value: new Date(Number.NaN) }), /valid/)
})

test("BSON decoder rejects malformed strings, nested documents, binary values, and non-buffer input", () => {
  const malformedCString = Buffer.from([
    12, 0, 0, 0, 0x10, 0x78, 0x79, 0x7a, 0x31, 0x32, 0x33, 0,
  ])
  assert.throws(() => decodeBsonDocument(malformedCString), /cstring/)

  const emptyString = Buffer.from([
    12, 0, 0, 0, 0x02, 0x78, 0, 0, 0, 0, 0, 0,
  ])
  assert.throws(() => decodeBsonDocument(emptyString), /string length/)

  const unterminatedString = Buffer.from([
    14, 0, 0, 0, 0x02, 0x78, 0, 2, 0, 0, 0, 0x61, 0x62, 0,
  ])
  assert.throws(() => decodeBsonDocument(unterminatedString), /terminator/)

  const invalidNestedLength = Buffer.from([
    12, 0, 0, 0, 0x03, 0x78, 0, 4, 0, 0, 0, 0,
  ])
  assert.throws(() => decodeBsonDocument(invalidNestedLength), /document length/)

  const invalidNestedTerminator = Buffer.from([
    13, 0, 0, 0, 0x03, 0x78, 0, 5, 0, 0, 0, 1, 0,
  ])
  assert.throws(() => decodeBsonDocument(invalidNestedTerminator), /terminator/)

  const invalidBinarySubtype = Buffer.from([
    13, 0, 0, 0, 0x05, 0x78, 0, 0, 0, 0, 0, 5, 0,
  ])
  assert.throws(() => decodeBsonDocument(invalidBinarySubtype), /binary length or subtype/)

  assert.throws(() => decodeBsonDocument("not a buffer"), /must be a Buffer/)
  assert.throws(
    () => decodeBsonDocument(createNestedBsonDocument({ depth: 101 })),
    /nesting depth/,
  )
})

