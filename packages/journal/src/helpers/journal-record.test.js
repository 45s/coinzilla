import assert from "node:assert/strict"
import test from "node:test"
import {
  serializeJournalRecord,
  parseJournalSession,
} from "./journal-record.js"

test("serializes events with additive versioned metadata", () => {
  const serialized = serializeJournalRecord({
    event: {
      id: "event-1",
      name: "market.updated",
      data: { symbol: "BTCUSDT" },
    },
  })
  const parsed = JSON.parse(serialized)

  assert.equal(parsed.id, "event-1")
  assert.equal(parsed.name, "market.updated")
  assert.deepEqual(parsed.__coinzillaJournal, {
    schemaVersion: 1,
    id: "event-1",
  })
  assert.equal(serialized.endsWith("\n"), true)
})

test("parses metadata records and legacy records with line positions", () => {
  const content = ${serializeJournalRecord({
    event: {
      id: "event-1",
      name: "a",
    },
  })}${JSON.stringify({
    id: "event-2",
    name: "b",
  })}\n

  const records = parseJournalSession({
    content,
    fileName: "session.jsonl",
    maxRecordBytes: 1024,
  })

  assert.equal(records.length, 2)
  assert.equal(records[0].schemaVersion, 1)
  assert.equal(records[0].position.lineNumber, 1)
  assert.equal(records[1].id, "event-2")
  assert.equal(records[1].position.lineNumber, 2)
})

test("rejects reserved metadata, invalid identities, and cyclic event values", () => {
  assert.throws(() => serializeJournalRecord({ event: { id: " " } }), TypeError)
  assert.throws(() => serializeJournalRecord({
    event: {
      id: "event-1",
      __coinzillaJournal: {},
    },
  }), /reserved/)
  const event = { id: "event-1" }
  event.self = event
  assert.throws(() => serializeJournalRecord({ event }), /cyclic reference/)
})

test("rejects incomplete, malformed, and oversized JSONL records", () => {
  assert.throws(() => parseJournalSession({
    content: '{"id":"event-1"}',
    fileName: "session.jsonl",
    maxRecordBytes: 1024,
  }), (error) => error.code === "JOURNAL_INCOMPLETE_RECORD")
  assert.throws(() => parseJournalSession({
    content: "not-json\n",
    fileName: "session.jsonl",
    maxRecordBytes: 1024,
  }), (error) => error.code === "JOURNAL_MALFORMED_RECORD")
  assert.throws(() => parseJournalSession({
    content: '{"id":"event-1"}\n',
    fileName: "session.jsonl",
    maxRecordBytes: 1,
  }), (error) => error.code === "JOURNAL_RECORD_TOO_LARGE")
})
