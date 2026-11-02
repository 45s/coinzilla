import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { EventBus } from "@coinzilla/event-bus"
import { Journal } from "./index.js"

async function createStoppedJournal() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-recovery-"))
  const journal = new Journal({ directory, eventBus: new EventBus() })
  return { directory, journal }
}

function legacyEvent(id, name = "order.created") {
  return { id, timestamp: "2026-01-01T00:00:00.000Z", name, source: "test", data: {} }
}

test("reads new versioned records after restart and preserves their payload", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-restart-"))
  const writerBus = new EventBus()
  const writer = new Journal({ eventBus: writerBus, directory })
  try {
    assert.equal((await writer.start()).ok, true)
    const published = writerBus.publish({ name: "order.filled", source: "test", data: { orderId: "42" } })
    assert.equal(published.ok, true)
    const flush = await writer.flush()
    assert.equal(flush.ok, true)
    assert.equal(flush.durable, true)
    assert.equal((await writer.close()).ok, true)

    const reader = new Journal({ directory, eventBus: new EventBus() })
    const result = await reader.read()
    assert.equal(result.ok, true)
    assert.equal(result.count, 1)
    assert.equal(result.records[0].id, published.event.id)
    assert.equal(result.records[0].schemaVersion, 1)
    assert.equal(result.records[0].payload.name, "order.filled")
    assert.equal(result.records[0].payload.data.orderId, "42")
    assert.deepEqual(result.records[0].position, {
      fileName: path.basename(writer.filePath),
      lineNumber: 1,
    })
    await reader.eventBus.close()
  } finally {
    await writerBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("reads legacy raw event sessions and sorts sessions deterministically", async () => {
  const { directory, journal } = await createStoppedJournal()
  try {
    await writeFile(path.join(directory, "2026-01-02_00-00-00.jsonl"), `${JSON.stringify(legacyEvent("second"))}\n`)
    await writeFile(path.join(directory, "2026-01-01_00-00-00.jsonl"), `${JSON.stringify(legacyEvent("first"))}\n`)
    const result = await journal.read()
    assert.equal(result.ok, true)
    assert.deepEqual(result.records.map((record) => record.id), ["first", "second"])
    assert.deepEqual(result.sessions, [
      "2026-01-01_00-00-00.jsonl",
      "2026-01-02_00-00-00.jsonl",
    ])
  } finally {
    await journal.eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects duplicate stable identities across session files", async () => {
  const { directory, journal } = await createStoppedJournal()
  try {
    const line = `${JSON.stringify(legacyEvent("duplicate"))}\n`
    await writeFile(path.join(directory, "2026-01-01_00-00-00.jsonl"), line)
    await writeFile(path.join(directory, "2026-01-02_00-00-00.jsonl"), line)
    const result = await journal.read()
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].code, "JOURNAL_DUPLICATE_RECORD_ID")
  } finally {
    await journal.eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects an incomplete final line without silently truncating it", async () => {
  const { directory, journal } = await createStoppedJournal()
  const filePath = path.join(directory, "2026-01-01_00-00-00.jsonl")
  const partial = JSON.stringify(legacyEvent("partial")).slice(0, -4)
  try {
    await writeFile(filePath, partial)
    const result = await journal.read()
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].code, "JOURNAL_INCOMPLETE_RECORD")
    assert.equal(await readFile(filePath, "utf8"), partial)
  } finally {
    await journal.eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects malformed JSON and empty records with source positions", async () => {
  const { directory, journal } = await createStoppedJournal()
  try {
    await writeFile(path.join(directory, "2026-01-01_00-00-00.jsonl"), "{bad json}\n")
    const result = await journal.read()
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].code, "JOURNAL_MALFORMED_RECORD")
    assert.deepEqual(result.errors[0].details, {
      fileName: "2026-01-01_00-00-00.jsonl",
      lineNumber: 1,
      cause: result.errors[0].details.cause,
    })
  } finally {
    await journal.eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects unsupported schema versions", async () => {
  const { directory, journal } = await createStoppedJournal()
  try {
    const envelope = {
      __coinzillaJournal: { schemaVersion: 99, id: "future" },
      payload: legacyEvent("future"),
    }
    await writeFile(path.join(directory, "2026-01-01_00-00-00.jsonl"), `${JSON.stringify(envelope)}\n`)
    const result = await journal.read()
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].code, "JOURNAL_UNSUPPORTED_SCHEMA_VERSION")
  } finally {
    await journal.eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("bounds record count, total bytes, and individual record size", async () => {
  const { directory, journal } = await createStoppedJournal()
  try {
    const first = legacyEvent("one")
    const second = legacyEvent("two")
    const content = `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`
    const filePath = path.join(directory, "2026-01-01_00-00-00.jsonl")
    await writeFile(filePath, content)

    const recordLimit = await journal.read({ maxRecords: 1 })
    assert.equal(recordLimit.ok, false)
    assert.equal(recordLimit.errors[0].code, "JOURNAL_RECOVERY_LIMIT_EXCEEDED")

    const byteLimit = await journal.read({ maxBytes: 1 })
    assert.equal(byteLimit.ok, false)
    assert.equal(byteLimit.errors[0].code, "JOURNAL_RECOVERY_LIMIT_EXCEEDED")

    const recordSizeLimit = await journal.read({ maxRecordBytes: 5 })
    assert.equal(recordSizeLimit.ok, false)
    assert.equal(recordSizeLimit.errors[0].code, "JOURNAL_RECORD_TOO_LARGE")
  } finally {
    await journal.eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("replays only after the complete journal validates and preserves record order", async () => {
  const { directory, journal } = await createStoppedJournal()
  const seen = []
  try {
    await writeFile(
      path.join(directory, "2026-01-01_00-00-00.jsonl"),
      `${JSON.stringify(legacyEvent("one"))}\n${JSON.stringify(legacyEvent("two"))}\n`,
    )
    const result = await journal.replay({
      handler: async ({ record }) => seen.push(record.id),
    })
    assert.equal(result.ok, true)
    assert.equal(result.replayed, 2)
    assert.deepEqual(seen, ["one", "two"])
  } finally {
    await journal.eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("does not invoke replay handlers when any later record is malformed", async () => {
  const { directory, journal } = await createStoppedJournal()
  const seen = []
  try {
    await writeFile(
      path.join(directory, "2026-01-01_00-00-00.jsonl"),
      `${JSON.stringify(legacyEvent("valid"))}\n{invalid}\n`,
    )
    const result = await journal.replay({
      handler: async ({ record }) => seen.push(record.id),
    })
    assert.equal(result.ok, false)
    assert.deepEqual(seen, [])
  } finally {
    await journal.eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("stops replay on handler failure and reports the last successful record", async () => {
  const { directory, journal } = await createStoppedJournal()
  const seen = []
  try {
    await writeFile(
      path.join(directory, "2026-01-01_00-00-00.jsonl"),
      `${JSON.stringify(legacyEvent("one"))}\n${JSON.stringify(legacyEvent("two"))}\n`,
    )
    const result = await journal.replay({
      handler: async ({ record }) => {
        seen.push(record.id)
        if (record.id === "two") return { ok: false, errors: [new Error("consumer failed")] }
      },
    })
    assert.equal(result.ok, false)
    assert.equal(result.replayed, 1)
    assert.equal(result.failedRecordId, "two")
    assert.deepEqual(seen, ["one", "two"])
  } finally {
    await journal.eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects read and replay while the writer is active", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-active-read-"))
  const eventBus = new EventBus()
  const journal = new Journal({ directory, eventBus })
  try {
    assert.equal((await journal.start()).ok, true)
    assert.equal((await journal.read()).ok, false)
    assert.equal((await journal.replay({ handler: async () => {} })).ok, false)
  } finally {
    await journal.close()
    await eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("poisons the writer after a write failure and rejects subsequent records", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-write-failure-"))
  const eventBus = new EventBus()
  const journal = new Journal({ directory, eventBus })
  try {
    assert.equal((await journal.start()).ok, true)
    journal.fileHandle.writeFile = async () => {
      throw new Error("simulated partial write")
    }
    const first = await journal.record({ event: legacyEvent("one") })
    const second = await journal.record({ event: legacyEvent("two") })
    assert.equal(first.ok, false)
    assert.equal(second.ok, false)
    assert.equal(journal.writeFailed, true)
    assert.equal((await journal.flush()).ok, false)
  } finally {
    await journal.close()
    await eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("requires stable event identity when appending records", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-record-id-"))
  const eventBus = new EventBus()
  const journal = new Journal({ directory, eventBus })
  try {
    assert.equal((await journal.start()).ok, true)
    const result = await journal.record({ event: { name: "missing.id" } })
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /stable id/)
  } finally {
    await journal.close()
    await eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})


test("returns an explicit error when the journal directory cannot be read", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-io-error-"))
  const notDirectory = path.join(root, "not-a-directory")
  const eventBus = new EventBus()
  const journal = new Journal({ directory: notDirectory, eventBus })
  try {
    await writeFile(notDirectory, "not a directory")
    const result = await journal.read()
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /ENOTDIR/)
  } finally {
    await eventBus.close()
    await rm(root, { recursive: true, force: true })
  }
})
