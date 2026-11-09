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

test("starts a real Journal with the shared process identity and closes it successfully", async () => {
  const directory = await createTempDirectory()
  const processIdentity = {
    startedAt: "2026-11-09T12:34:56.789Z",
    runtimeSessionId: "shared-runtime-session",
  }
  const service = prepareOptionalJournal({
    eventBus: new EventBus(),
    directory,
    logger,
    processIdentity,
  })

  try {
    const started = await service.ready
    assert.equal(started.ok, true)
    assert.equal(
      path.basename(started.filePath),
      "2026-11-09_12-34-56-shared-runtime-session.jsonl",
      "Journal filename must use the same UTC process timestamp and runtime session ID as diagnostic logs",
    )
    assert.equal(service.status.state, "ready")
    assert.equal(service.status.started, true)
    assert.equal("recovery" in service, false)

    const closed = await service.close()
    assert.equal(closed.ok, true)
    assert.equal(closed.durable, true)
    assert.equal(service.status.state, "closed")
    assert.equal(service.status.closed, true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("starts a new Journal writer without reading previous sessions", async () => {
  const calls = []
  const service = prepareOptionalJournal({
    eventBus: new EventBus(),
    directory: "/unused-by-fake-journal",
    logger,
    journalFactory: () => ({
      read: async () => {
        calls.push("read")
        throw new Error("historical reads must remain disabled")
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
  assert.deepEqual(calls, ["start"])
  assert.equal("recovery" in service, false)
})

test("starts the Journal writer even when historical records are malformed", async () => {
  let startCalls = 0
  const error = new Error("corrupt persisted history")
  error.code = "JOURNAL_MALFORMED_RECORD"
  const service = prepareOptionalJournal({
    eventBus: new EventBus(),
    directory: "/unused-by-fake-journal",
    logger,
    journalFactory: () => ({
      read: async () => ({ ok: false, errors: [error] }),
      start: async () => { startCalls += 1; return { ok: true } },
      close: async () => ({ ok: true, closed: true }),
    }),
  })

  const result = await service.ready
  assert.equal(result.ok, true)
  assert.equal(startCalls, 1)
  assert.equal(service.status.state, "ready")
})

test("starts a Journal in a new directory without inspecting prior history", async () => {
  const root = await createTempDirectory()
  const directory = path.join(root, "not-created-yet")
  const service = prepareOptionalJournal({ eventBus: new EventBus(), directory, logger })

  try {
    assert.equal((await service.ready).ok, true)
    assert.equal(service.status.state, "ready")
    assert.equal("recovery" in service, false)
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

test("closes a Journal whose startup failed after its startup rollback completed", async () => {
  const startupError = new Error("journal directory is already locked")
  let closeCalls = 0
  const service = prepareOptionalJournal({
    eventBus: new EventBus(),
    directory: "/unused",
    logger,
    journalFactory: () => ({
      start: async () => ({ ok: false, errors: [startupError] }),
      close: async () => {
        closeCalls += 1
        return { ok: true, closed: true, durable: true }
      },
    }),
  })

  const ready = await service.ready
  assert.equal(ready.ok, false, "The original Journal startup failure must remain visible to readiness consumers.")
  assert.equal(ready.errors[0], startupError, "Readiness must preserve the original startup error identity.")

  const closed = await service.close()
  assert.equal(closeCalls, 1, "Shutdown must invoke Journal.close() so its lifecycle can confirm startup rollback.")
  assert.equal(closed.ok, true, "A completed cleanup after failed startup must not be reported as a second shutdown failure.")
  assert.equal(closed.closed, true, "The wrapper must expose that the failed-start Journal lifecycle was closed.")
  assert.equal(service.status.state, "closed", "The wrapper health state must reflect completed cleanup rather than remain failed.")
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
