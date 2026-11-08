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
      })}\\n`,
    },
    {
      label: "null record",
      content: "null\\n",
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
    content: `${JSON.stringify(legacyPayload)}\\n`,
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
