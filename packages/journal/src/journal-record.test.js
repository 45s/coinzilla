import test from "node:test"
import assert from "node:assert/strict"

import { parseJournalSession, serializeJournalRecord } from "./helpers/journal-record.js"

const FILE_NAME = "2026-11-08_12-30-00.jsonl"

test("serializes and recovers a schema-v1 record without mutating its source event", () => {
  const event = Object.freeze({
    id: "event-123",
    name: "order.filled",
    source: "test",
    data: Object.freeze({ orderId: "42" }),
  })

  const serialized = serializeJournalRecord({ event })
  const persisted = JSON.parse(serialized)

  assert.deepEqual(
    persisted,
    {
      ...event,
      __coinzillaJournal: { schemaVersion: 1, id: event.id },
    },
    "Serialized Journal data must retain source fields and add only the reserved schema-v1 identity metadata.",
  )
  assert.equal(
    serialized.endsWith("\n"),
    true,
    "Every serialized Journal record must end with exactly the JSONL line terminator.",
  )

  const [recovered] = parseJournalSession({
    content: serialized,
    fileName: FILE_NAME,
    maxRecordBytes: 1024,
  })

  assert.deepEqual(
    recovered,
    {
      id: event.id,
      schemaVersion: 1,
      payload: { ...event, data: { orderId: "42" } },
      position: { fileName: FILE_NAME, lineNumber: 1 },
    },
    "A schema-v1 record must recover the original event payload, stable ID, and exact source position.",
  )
  assert.deepEqual(
    event,
    {
      id: "event-123",
      name: "order.filled",
      source: "test",
      data: { orderId: "42" },
    },
    "Serialization must not mutate or decorate the caller-owned source event.",
  )
})

test("rejects a source event whose root toJSON hook could replace the Journal record envelope", () => {
  const event = {
    id: "event-hook",
    name: "order.filled",
    toJSON() {
      return { id: "rewritten-by-hook" }
    },
  }

  assert.throws(
    () => serializeJournalRecord({ event }),
    {
      name: "TypeError",
      message: /toJSON/,
    },
    "Journal must reject a root serialization hook instead of persisting a payload that discards its reserved identity metadata.",
  )
})

test("rejects missing, blank, whitespace-only, and non-string source event IDs", () => {
  const invalidEvents = [
    { name: "missing-id" },
    { id: "", name: "blank-id" },
    { id: "   ", name: "whitespace-id" },
    { id: 123, name: "numeric-id" },
  ]

  for (const event of invalidEvents) {
    assert.throws(
      () => serializeJournalRecord({ event }),
      TypeError,
      "Journal serialization must require a non-empty string source-event ID for every persisted record.",
    )
  }
})

test("rejects source events that collide with Journal-owned metadata", () => {
  const event = {
    id: "event-reserved",
    name: "order.filled",
    __coinzillaJournal: { schemaVersion: 1, id: "forged" },
  }

  assert.throws(
    () => serializeJournalRecord({ event }),
    {
      name: "TypeError",
      message: /reserved/,
    },
    "Source events must not supply the metadata field reserved for Journal record identity and schema.",
  )
})

test("rejects persisted records when metadata identity does not match the source payload", () => {
  const persisted = {
    id: "source-id",
    name: "order.filled",
    __coinzillaJournal: { schemaVersion: 1, id: "different-id" },
  }

  assert.throws(
    () => parseJournalSession({
      content: `${JSON.stringify(persisted)}\n`,
      fileName: FILE_NAME,
      maxRecordBytes: 1024,
    }),
    {
      code: "JOURNAL_MALFORMED_RECORD",
    },
    "Recovered record identity must match the source payload ID so replay cannot silently change event identity.",
  )
})

test("accepts CRLF session lines while preserving the original record position", () => {
  const serialized = serializeJournalRecord({
    event: { id: "event-crlf", name: "order.created" },
  }).replace("\n", "\r\n")

  const [recovered] = parseJournalSession({
    content: serialized,
    fileName: FILE_NAME,
    maxRecordBytes: 1024,
  })

  assert.deepEqual(
    recovered.position,
    { fileName: FILE_NAME, lineNumber: 1 },
    "CRLF normalization must preserve the original filename and one-based JSONL line position.",
  )
})

test("rejects malformed metadata objects and non-object JSON values", () => {
  const invalidLines = [
    {
      label: "array metadata",
      content: `${JSON.stringify({
        id: "event-array-metadata",
        __coinzillaJournal: [],
      })}\n`,
    },
    {
      label: "null record",
      content: "null\n",
    },
  ]

  for (const invalid of invalidLines) {
    assert.throws(
      () => parseJournalSession({
        content: invalid.content,
        fileName: FILE_NAME,
        maxRecordBytes: 1024,
      }),
      {
        code: "JOURNAL_MALFORMED_RECORD",
      },
      `Journal parsing must reject ${invalid.label} instead of returning an invalid recovered record.`,
    )
  }
})

test("recovers legacy raw event lines with the same stable record shape", () => {
  const legacyPayload = {
    id: "legacy-event",
    name: "order.created",
    source: "test",
    data: { orderId: "legacy-42" },
  }

  const [recovered] = parseJournalSession({
    content: `${JSON.stringify(legacyPayload)}\n`,
    fileName: FILE_NAME,
    maxRecordBytes: 1024,
  })

  assert.deepEqual(
    recovered,
    {
      id: legacyPayload.id,
      schemaVersion: 1,
      payload: legacyPayload,
      position: { fileName: FILE_NAME, lineNumber: 1 },
    },
    "Legacy raw event lines must recover into the same identity, schema, payload, and position contract as current records.",
  )
})


test("rejects nested values that JSONL would omit, coerce, or execute", () => {
  const sparseArray = []
  sparseArray.length = 2
  sparseArray[1] = "present"

  const arrayWithCustomProperty = []
  arrayWithCustomProperty.extra = "not part of the JSON array contract"

  const symbolKeyedData = { visible: "value" }
  symbolKeyedData[Symbol("hidden")] = "not JSON-representable"

  const nonEnumerableData = {}
  Object.defineProperty(nonEnumerableData, "hidden", {
    value: "not JSON-representable",
    enumerable: false,
  })

  let getterCalls = 0
  const accessorData = {}
  Object.defineProperty(accessorData, "value", {
    enumerable: true,
    get() {
      getterCalls += 1
      return "must not be invoked"
    },
  })

  const customPrototypeData = Object.create({ inherited: "value" })
  customPrototypeData.own = "value"

  const cyclicData = {}
  cyclicData.self = cyclicData

  const invalidValues = [
    { label: "undefined object property", data: { nested: { value: undefined } } },
    { label: "undefined array entry", data: { values: [undefined] } },
    { label: "sparse array hole", data: { values: sparseArray } },
    { label: "BigInt", data: { amount: 1n } },
    { label: "NaN", data: { amount: NaN } },
    { label: "positive infinity", data: { amount: Infinity } },
    { label: "negative infinity", data: { amount: -Infinity } },
    { label: "negative zero", data: { amount: -0 } },
    { label: "cyclic graph", data: cyclicData },
    { label: "nested toJSON hook", data: { nested: { toJSON() { return { rewritten: true } } } } },
    { label: "symbol-keyed property", data: symbolKeyedData },
    { label: "accessor property", data: accessorData },
    { label: "non-enumerable property", data: nonEnumerableData },
    { label: "custom array property", data: { values: arrayWithCustomProperty } },
    { label: "custom prototype", data: customPrototypeData },
  ]

  for (const [index, invalid] of invalidValues.entries()) {
    assert.throws(
      () => serializeJournalRecord({
        event: { id: "event-invalid-" + index, name: "journal.invalid_value", data: invalid.data },
      }),
      { name: "TypeError" },
      `Journal must reject ${invalid.label} before JSON.stringify can omit, coerce, or execute it.`,
    )
  }

  assert.equal(
    getterCalls,
    0,
    "Journal validation must inspect property descriptors and reject accessors without invoking user getters.",
  )
})

test("accepts shared references as repeated JSON subtrees without preserving alias identity", () => {
  const shared = Object.create(null)
  shared.orderId = "42"
  const event = {
    id: "event-shared-reference",
    name: "order.filled",
    data: { first: shared, second: shared },
  }

  const serialized = serializeJournalRecord({ event })
  const [recovered] = parseJournalSession({
    content: serialized,
    fileName: FILE_NAME,
    maxRecordBytes: 1024,
  })

  assert.deepEqual(
    recovered.payload.data,
    { first: { orderId: "42" }, second: { orderId: "42" } },
    "Shared source references must persist as equivalent repeated JSON subtrees.",
  )
  assert.notStrictEqual(
    recovered.payload.data.first,
    recovered.payload.data.second,
    "The persisted JSONL contract must explicitly exclude source object-identity preservation.",
  )
})
