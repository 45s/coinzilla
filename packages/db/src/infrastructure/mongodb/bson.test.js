import assert from "node:assert/strict"
import test from "node:test"

import { decodeBsonDocument, encodeBsonDocument } from "./bson.js"

test("BSON encoder writes the canonical empty document", () => {
  const encoded = encodeBsonDocument({
    document: {},
  })

  assert.deepEqual(
    [...encoded],
    [5, 0, 0, 0, 0],
    "An empty BSON document must contain its five-byte length and terminator",
  )
})

test("BSON encoder writes a canonical UTF-8 string element", () => {
  const encoded = encodeBsonDocument({
    document: {
      hello: "world",
    },
  })

  assert.equal(
    encoded.toString("hex"),
    "160000000268656c6c6f0006000000776f726c640000",
    "String fields must use BSON type 0x02, UTF-8 byte lengths, and null terminators",
  )
})

test("BSON codec round-trips JSON-safe nested records and arrays", () => {
  const source = {
    id: "record-1",
    name: "München",
    enabled: true,
    disabled: false,
    absent: null,
    count: 42,
    ratio: 1.25,
    nested: {
      label: "nested",
    },
    values: ["one", 2, false, null],
  }

  const encoded = encodeBsonDocument({
    document: source,
  })
  const decoded = decodeBsonDocument({
    buffer: encoded,
  })

  assert.deepEqual(
    decoded.document,
    source,
    "BSON encoding and decoding must preserve the JSON-safe record values and nested structure",
  )
  assert.equal(
    decoded.bytesRead,
    encoded.length,
    "Decoding one BSON document must report exactly the consumed byte length",
  )
})

test("BSON decoder reads one document at a non-zero buffer offset", () => {
  const encoded = encodeBsonDocument({
    document: {
      value: "offset",
    },
  })
  const prefix = Buffer.from([9, 8, 7])
  const combined = Buffer.concat([prefix, encoded, prefix])

  const decoded = decodeBsonDocument({
    buffer: combined,
    offset: prefix.length,
  })

  assert.deepEqual(
    decoded.document,
    {
      value: "offset",
    },
    "The decoder must honor the supplied offset without interpreting adjacent bytes as part of the document",
  )
  assert.equal(
    decoded.bytesRead,
    encoded.length,
    "The decoder must report the document length independently of its buffer offset",
  )
})

test("BSON encoder rejects values outside the supported JSON document contract", () => {
  const invalidDocuments = [
    {
      id: "undefined",
      value: undefined,
    },
    {
      id: "function",
      value: () => "not BSON",
    },
    {
      id: "bigint",
      value: 1n,
    },
    {
      id: "infinity",
      value: Number.POSITIVE_INFINITY,
    },
    {
      id: "date",
      value: new Date(0),
    },
  ]

  for (const document of invalidDocuments) {
    assert.throws(
      () => encodeBsonDocument({
        document,
      }),
      TypeError,
      "Unsupported values must be rejected rather than silently coerced into a BSON representation",
    )
  }
})

test("BSON encoder rejects circular references and sparse arrays", () => {
  const circular = {
    id: "circular",
  }
  circular.self = circular

  const sparse = new Array(2)
  sparse[1] = "present"

  for (const document of [
    circular,
    {
      id: "sparse",
      values: sparse,
    },
  ]) {
    assert.throws(
      () => encodeBsonDocument({
        document,
      }),
      TypeError,
      "Circular references and sparse arrays must not produce ambiguous BSON documents",
    )
  }
})

test("BSON decoder rejects invalid buffers and malformed document boundaries", () => {
  assert.throws(
    () => decodeBsonDocument({
      buffer: "not a buffer",
    }),
    TypeError,
    "BSON decoding must require a Buffer input",
  )

  for (const buffer of [
    Buffer.alloc(0),
    Buffer.from([4, 0, 0, 0, 0]),
    Buffer.from([5, 0, 0, 0, 1]),
    Buffer.from([20, 0, 0, 0, 0]),
  ]) {
    assert.throws(
      () => decodeBsonDocument({
        buffer,
      }),
      RangeError,
      "BSON decoding must reject truncated documents, invalid minimum lengths, missing terminators, and out-of-bounds lengths",
    )
  }
})
