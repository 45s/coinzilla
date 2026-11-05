import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { EventBus } from "@coinzilla/event-bus"
import { Journal } from "@coinzilla/journal"
import { prepareOptionalJournal } from "./prepare-optional-journal.js"

const logger = { info() {}, error() {}, debug() {} }
const createTempDirectory = () =>
  mkdtemp(path.join(os.tmpdir(), "harvester-journal-"))

test("starts a real Journal asynchronously and closes it successfully", async () => {
  const directory = await createTempDirectory()
  const service = prepareOptionalJournal({
    eventBus: new EventBus(),
    directory,
    logger,
  })

  try {
    const started = await service.ready
    assert.equal(started.ok, true)
    assert.equal(service.status.state, "ready")
    assert.equal(service.status.started, true)
    const recovery = await service.recovery
    assert.equal(recovery.ok, true)
    assert.equal(recovery.available, true)
    assert.deepEqual(recovery.records, [])

    const closed = await service.close()
    assert.equal(closed.ok, true)
    assert.equal(closed.durable, true)
    assert.equal(service.status.state, "closed")
    assert.equal(service.status.closed, true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("reads and validates previous sessions before starting a new Journal writer", async () => {
  const calls = []
  const records = [{ id: "record-1", payload: { name: "order.submission_requested" } }]
  const service = prepareOptionalJournal({
    eventBus: new EventBus(),
    directory: "/unused-by-fake-journal",
    logger,
    journalFactory: () => ({
      read: async () => {
        calls.push("read")
        return { ok: true, records, count: 1, sessions: ["previous.jsonl"], bytesRead: 100 }
      },
      start: async () => {
        calls.push("start")
        return { ok: true, filePath: "/unused-by-fake-journal/current.jsonl" }
      },
      flush: async () => ({ ok: true, durable: true }),
      close: async () => ({ ok: true, closed: true }),
    }),
  })

  assert.equal((await service.ready).ok, true)
  assert.deepEqual(calls, ["read", "start"])
  const recovery = await service.recovery
  assert.equal(recovery.available, true)
  assert.deepEqual(recovery.records, records)
  assert.deepEqual(recovery.sessions, ["previous.jsonl"])
})

test("treats a missing Journal directory as an empty first-run history", async () => {
  const root = await createTempDirectory()
  const directory = path.join(root, "not-created-yet")
  const service = prepareOptionalJournal({ eventBus: new EventBus(), directory, logger })

  try {
    assert.equal((await service.ready).ok, true)
    const recovery = await service.recovery
    assert.equal(recovery.ok, true)
    assert.equal(recovery.available, true)
    assert.equal(recovery.empty, true)
    assert.deepEqual(recovery.records, [])
  } finally {
    await service.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("reports an invalid journal directory without throwing", async () => {
  const directory = await createTempDirectory()
  const filePath = path.join(directory, "not-a-directory")
  await writeFile(filePath, "file")

  try {
    const service = prepareOptionalJournal({
      eventBus: new EventBus(),
      directory: filePath,
      logger,
    })
    const result = await service.ready

    assert.equal(result.ok, false)
    assert.equal(service.status.state, "failed")
    assert.equal(service.status.started, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("returns immediately while Journal initialization is still pending", async () => {
  let resolveStart
  const service = prepareOptionalJournal({
    eventBus: new EventBus(),
    directory: "/unused-by-fake-journal",
    logger,
    journalFactory: () => ({
      start: () => new Promise((resolve) => { resolveStart = resolve }),
      close: async () => ({ ok: true, closed: true }),
    }),
  })

  assert.equal(service.status.state, "starting")
  await Promise.resolve()
  assert.equal(typeof resolveStart, "function")
  assert.equal(service.status.state, "starting")

  resolveStart({ ok: true, filePath: "/unused-by-fake-journal/session.jsonl" })
  assert.equal((await service.ready).ok, true)
  assert.equal(service.status.state, "ready")
  assert.equal((await service.close()).ok, true)
})

test("contains an asynchronous Journal initialization rejection", async () => {
  const error = new Error("journal initialization rejected")
  const service = prepareOptionalJournal({
    eventBus: new EventBus(),
    directory: "/unused",
    logger,
    journalFactory: () => ({
      start: async () => { throw error },
      close: async () => ({ ok: true, closed: true }),
    }),
  })

  const result = await service.ready
  assert.equal(result.ok, false)
  assert.equal(result.errors[0], error)
  assert.equal(service.status.state, "failed")
})

test("contains a Journal construction exception even when logger.error throws", async () => {
  const error = new Error("construction failed")
  const service = prepareOptionalJournal({
    eventBus: new EventBus(),
    directory: "/unused",
    logger: { error() { throw new Error("logger failed") } },
    journalFactory: () => { throw error },
  })

  const result = await service.ready
  assert.equal(result.ok, false)
  assert.equal(result.errors[0], error)
  assert.equal(service.status.state, "failed")
})

test("disabled Journal does not construct or start a writer", async () => {
  let constructed = false
  const service = prepareOptionalJournal({
    eventBus: new EventBus(),
    enabled: false,
    journalFactory: () => { constructed = true; throw new Error("must not run") },
    logger,
  })

  const result = await service.ready
  assert.equal(result.ok, true)
  assert.equal(result.disabled, true)
  assert.equal(service.status.state, "disabled")
  assert.equal(constructed, false)
  assert.equal((await service.close()).disabled, true)
})

test("reports a write failure through live health status without affecting EventBus publication", async () => {
  const directory = await createTempDirectory()
  const eventBus = new EventBus()
  const writeError = new Error("simulated disk write failure")
  const service = prepareOptionalJournal({
    eventBus,
    directory,
    logger,
    journalFactory: (options) => {
      const journal = new Journal(options)
      const start = journal.start.bind(journal)
      journal.start = async () => {
        const result = await start()
        if (result.ok) {
          journal.fileHandle = {
            writeFile: async () => { throw writeError },
            sync: async () => {},
            close: async () => {},
          }
        }
        return result
      }
      return journal
    },
  })

  try {
    assert.equal((await service.ready).ok, true)
    const published = eventBus.publish({
      name: "harvester.test",
      source: "harvester",
      data: { mode: "read-only" },
    })
    assert.equal(published.ok, true)
    await eventBus.flush()

    assert.equal(service.status.state, "degraded")
    assert.equal(service.status.writeFailed, true)
    assert.equal(service.status.writeErrorCount, 1)

    const closed = await service.close()
    assert.equal(closed.ok, false)
    assert.equal(service.status.state, "close_failed")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("flush waits for Journal durability", async () => {
  const service = prepareOptionalJournal({
    eventBus: new EventBus(), directory: "/unused", logger,
    journalFactory: () => ({
      start: async () => ({ ok: true }),
      flush: async () => ({ ok: true, durable: true }),
      close: async () => ({ ok: true, closed: true }),
    }),
  })
  assert.equal((await service.ready).ok, true)
  assert.deepEqual(await service.flush(), { ok: true, durable: true })
  assert.equal((await service.close()).ok, true)
})

test("fails closed when Journal has no durable flush capability", async () => {
  const service = prepareOptionalJournal({
    eventBus: new EventBus(), directory: "/unused", logger,
    journalFactory: () => ({ start: async () => ({ ok: true }), close: async () => ({ ok: true }) }),
  })
  assert.equal((await service.ready).ok, true)
  const result = await service.flush()
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /must provide flush/)
})
