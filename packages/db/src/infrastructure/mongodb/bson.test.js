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
  const binary = new BsonBinary(Buffer.from("00112233445566778899aabbccddeeff", "hex"), 4)
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
    { "invalid\\u0000key": true },
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
    () => encodeBsonDocument({ value: "\\ud800" }),
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
    () => new BsonBinary(Buffer.from([1]), 4),
    /exactly 16 bytes/,
  )
  assert.throws(
    () => new BsonBinary(Buffer.from([1]), 2),
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
