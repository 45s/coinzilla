import test from "node:test"
import { spawnSync } from "node:child_process"
import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { EventBus } from "@coinzilla/event-bus"
import { Journal } from "../src/index.js"
import { JOURNAL_STORE } from "./journal-store-injection.js"

async function createTestJournal() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-"))

  const logs = []

  const logger = {
    info: (message, context) => logs.push({ level: "info", message, context }),
    system: (message, context) => logs.push({ level: "system", message, context }),
    error: (message, context) =>
      logs.push({ level: "error", message, context }),
  }

  const eventBus = new EventBus({ logger })
  const journal = new Journal({ eventBus, directory, logger })

  const result = await journal.start()

  assert.equal(result.ok, true)

  return { directory, eventBus, journal, logs, filePath: result.filePath }
}


test("prevents a second process from writing to an active journal directory", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-process-lock-"))
  const eventBus = new EventBus()
  const journal = new Journal({ eventBus, directory })
  const childScript = `
    import path from "node:path"
    import { pathToFileURL } from "node:url"
    const { EventBus } = await import(pathToFileURL(path.resolve("../event-bus/src/index.js")))
    const { Journal } = await import(pathToFileURL(path.resolve("src/index.js")))
    const logger = { info() {}, system() {}, error() {} }
    const eventBus = new EventBus({ logger })
    const journal = new Journal({ eventBus, directory: process.argv[1], logger })
    const result = await journal.start()
    const outcome = { ok: result.ok, code: result.errors?.[0]?.code ?? null }
    if (result.ok) {
      const closeResult = await journal.close()
      outcome.closeOk = closeResult.ok
    }
    await eventBus.close()
    process.stdout.write(JSON.stringify(outcome))
  `
  const runChildJournal = () => spawnSync(
    process.execPath,
    ["--input-type=module", "-e", childScript, directory],
    { encoding: "utf8", timeout: 5000 },
  )

  try {
    const parentStart = await journal.start()
    assert.equal(
      parentStart.ok,
      true,
      "The first process must acquire exclusive ownership before creating its Journal session.",
    )

    const competingProcess = runChildJournal()
    assert.equal(
      competingProcess.error,
      undefined,
      "The competing process must finish its lock attempt without a spawn or timeout error.",
    )
    assert.equal(
      competingProcess.status,
      0,
      `The competing process must exit cleanly after reporting lock contention; stderr: ${competingProcess.stderr}`,
    )
    assert.deepEqual(
      JSON.parse(competingProcess.stdout),
      { ok: false, code: "JOURNAL_DIRECTORY_LOCKED" },
      "A separate process must fail closed while another process owns the same Journal directory.",
    )

    const parentClose = await journal.close()
    assert.equal(
      parentClose.ok,
      true,
      "The owning process must finish its durable close before relinquishing directory ownership.",
    )

    const afterRelease = runChildJournal()
    assert.equal(
      afterRelease.error,
      undefined,
      "A new process must be able to attempt ownership after the previous writer closes.",
    )
    assert.equal(
      afterRelease.status,
      0,
      `The post-close process must exit cleanly; stderr: ${afterRelease.stderr}`,
    )
    assert.deepEqual(
      JSON.parse(afterRelease.stdout),
      { ok: true, code: null, closeOk: true },
      "A different process may acquire the directory only after the prior writer has durably closed.",
    )
  } finally {
    await journal.close()
    await eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})


test("refuses to take over an existing journal directory lock", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-stale-lock-"))
  const lockFilePath = path.join(directory, ".coinzilla-journal.lock")
  const existingLock = JSON.stringify({ pid: 98765, startedAt: "2026-11-08T00:00:00.000Z" }) + "\n"
  await writeFile(lockFilePath, existingLock, { flag: "wx" })
  const logger = { info() {}, system() {}, error() {} }
  const eventBus = new EventBus({ logger })
  const journal = new Journal({ eventBus, directory, logger })

  try {
    const result = await journal.start()
    assert.equal(
      result.ok,
      false,
      "A Journal must not start when the directory already contains another writer's lock.",
    )
    assert.equal(
      result.errors[0].code,
      "JOURNAL_DIRECTORY_LOCKED",
      "Lock contention must return a stable error code that callers can distinguish from unrelated startup failures.",
    )
    assert.equal(
      await readFile(lockFilePath, "utf8"),
      existingLock,
      "A failed contender must preserve the existing lock byte-for-byte rather than stealing or rewriting it.",
    )
    assert.equal(
      (await readdir(directory)).filter((name) => name.endsWith(".jsonl")).length,
      0,
      "A contender must not create a session file when directory ownership was not acquired.",
    )
  } finally {
    await journal.close()
    await eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})


test("releases directory ownership when session-file creation fails during startup", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-lock-rollback-"))
  const lockFilePath = path.join(directory, ".coinzilla-journal.lock")
  const eventBus = new EventBus()
  const journal = new Journal({ eventBus, directory })
  let observedLockBeforeSessionCreation = false

  journal.createSessionFile = async () => {
    try {
      await readFile(lockFilePath, "utf8")
      observedLockBeforeSessionCreation = true
    } catch {
      observedLockBeforeSessionCreation = false
    }
    throw new Error("simulated session-file creation failure")
  }

  try {
    const result = await journal.start()
    assert.equal(
      observedLockBeforeSessionCreation,
      true,
      "The exclusive directory lock must be acquired before any session-file creation attempt.",
    )
    assert.equal(
      result.ok,
      false,
      "A session-file creation failure must remain a failed startup rather than leaving a partially active Journal.",
    )
    assert.match(
      result.errors[0].message,
      /simulated session-file creation failure/,
      "Startup must retain the original session-file creation failure for diagnosis.",
    )
    assert.equal(
      (await readdir(directory)).includes(path.basename(lockFilePath)),
      false,
      "A failed startup must release its own lock so a later process is not stranded.",
    )
  } finally {
    await journal.close()
    await eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("creates a timestamped JSONL session file", async () => {
  const context = await createTestJournal()

  try {
    assert.match(
      path.basename(context.filePath),
      /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+)?\.jsonl$/,
    )

    assert.ok(
      (await readdir(context.directory)).includes(
        path.basename(context.filePath),
      ),
    )
  } finally {
    await context.journal.close()
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test("writes published events as JSONL records", async () => {
  const context = await createTestJournal()

  try {
    const published = context.eventBus.publish({
      name: "order.filled",
      source: "binance",
      data: {
        symbol: "DOGEFDUSD",
        orderId: "123",
        quantity: "100",
      },
    })

    assert.equal(published.ok, true)

    const result = await context.journal.flush()

    assert.equal(result.ok, true)

    const content = await readFile(context.filePath, "utf8")
    const lines = content.trim().split("\n")

    assert.equal(lines.length, 1)

    const stored = JSON.parse(lines[0])
    assert.equal(stored.__coinzillaJournal.schemaVersion, 1)
    assert.equal(stored.__coinzillaJournal.id, published.event.id)
    assert.equal(stored.name, "order.filled")
    assert.equal(stored.data.orderId, "123")
    assert.equal(stored.id, published.event.id)
  } finally {
    await context.journal.close()
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test("preserves event order when multiple events are published", async () => {
  const context = await createTestJournal()

  try {
    context.eventBus.publish({
      name: "bot.started",
      source: "bot",
    })

    context.eventBus.publish({
      name: "ws.connected",
      source: "binance",
    })

    context.eventBus.publish({
      name: "order.created",
      source: "binance",
    })

    const result = await context.journal.flush()

    assert.equal(result.ok, true)

    const content = await readFile(context.filePath, "utf8")
    const events = content
      .trim()
      .split("\n")
      .map((line) => {
        const { __coinzillaJournal, ...event } = JSON.parse(line)
        return event
      })

    assert.deepEqual(
      events.map((event) => event.name),
      ["bot.started", "ws.connected", "order.created"],
    )
  } finally {
    await context.journal.close()
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test("close drains events published immediately before shutdown", async () => {
  const context = await createTestJournal()

  try {
    context.eventBus.publish({
      name: "order.filled",
      source: "binance",
      data: { orderId: "456" },
    })

    const result = await context.journal.close()

    assert.equal(result.ok, true)

    const content = await readFile(context.filePath, "utf8")
    const { __coinzillaJournal, ...event } = JSON.parse(content.trim())

    assert.equal(event.name, "order.filled")
    assert.equal(event.data.orderId, "456")
  } finally {
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test("rejects records after close", async () => {
  const context = await createTestJournal()

  try {
    await context.journal.close()

    const result = await context.journal.record({
      event: {
        id: "test",
        name: "bot.started",
      },
    })

    assert.equal(result.ok, false)
  } finally {
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test("logs journal startup and shutdown", async () => {
  const context = await createTestJournal()

  try {
    await context.journal.close()

    assert.ok(context.logs.some(({ level, message }) => level === "system" && message === "Journal started"))
    assert.ok(context.logs.some(({ level, message }) => level === "system" && message === "Journal closed"))
  } finally {
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})


test("rejects invalid records without writing them", async () => {
  const context = await createTestJournal()

  try {
    for (const event of [undefined, null, "event", 123, []]) {
      const result = await context.journal.record({ event })
      assert.equal(result.ok, false)
    }

    const circular = {}
    circular.self = circular
    const result = await context.journal.record({ event: circular })
    assert.equal(result.ok, false)

    const flushResult = await context.journal.flush()
    assert.equal(flushResult.ok, true)
    assert.equal(await readFile(context.filePath, "utf8"), "")
  } finally {
    await context.journal.close()
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test("rejects overlapping startup attempts without leaking a session file or subscription", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-concurrent-start-"))
  const eventBus = new EventBus()
  const journal = new Journal({ eventBus, directory })

  try {
    const [first, second] = await Promise.all([journal.start(), journal.start()])

    assert.equal(
      [first, second].filter((result) => result.ok).length,
      1,
      "Only one overlapping start call on the same Journal instance may become the active writer.",
    )
    assert.equal(
      [first, second].filter((result) => !result.ok).length,
      1,
      "The concurrent start call must fail instead of creating another session or subscription.",
    )
    assert.equal(
      journal.started,
      true,
      "The accepted start call must leave the Journal in its active state.",
    )
    assert.equal(
      journal.starting,
      false,
      "The Journal must clear its startup-in-progress flag after both start calls settle.",
    )
    assert.ok(
      journal.fileHandle,
      "The accepted start call must retain exactly one active session file handle.",
    )
    assert.ok(
      journal.subscription,
      "The accepted start call must retain exactly one EventBus subscription.",
    )

    const files = await readdir(directory)
    assert.equal(
      files.filter((fileName) => fileName.endsWith(".jsonl")).length,
      1,
      "Concurrent start calls must create exactly one JSONL session file, excluding the separate lock metadata file.",
    )
    assert.ok(
      files.includes(".coinzilla-journal.lock"),
      "The active Journal must retain its exclusive directory lock while the session is open.",
    )

    const closeResult = await journal.close()
    assert.equal(
      closeResult.ok,
      true,
      "The single accepted Journal session must close durably and release its directory lock.",
    )
  } finally {
    await eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("closes a session file created after close cancels startup", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-start-close-race-"))
  const eventBus = new EventBus()
  const journal = new Journal({ eventBus, directory })

  let releaseCreateSessionFile
  let signalCreateSessionFileStarted
  const createSessionFileStarted = new Promise((resolve) => {
    signalCreateSessionFileStarted = resolve
  })
  const createSessionFileGate = new Promise((resolve) => {
    releaseCreateSessionFile = resolve
  })
  const originalCreateSessionFile = journal.createSessionFile.bind(journal)

  journal.createSessionFile = async () => {
    signalCreateSessionFileStarted()
    await createSessionFileGate
    return originalCreateSessionFile()
  }

  try {
    const startPromise = journal.start()
    await createSessionFileStarted

    const closeResult = await journal.close()
    assert.equal(closeResult.ok, true)
    assert.equal(journal.closed, true)

    releaseCreateSessionFile()

    const startResult = await startPromise
    assert.equal(startResult.ok, false)
    assert.match(startResult.errors[0].message, /closed during startup/)
    assert.equal(journal.started, false)
    assert.equal(journal.starting, false)
    assert.equal(journal.fileHandle, null)
    assert.equal(journal.subscription, null)
    assert.equal((await readdir(directory)).length, 1)
  } finally {
    releaseCreateSessionFile()
    await eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("does not allow a journal to start more than once or restart after close", async () => {
  const context = await createTestJournal()

  try {
    const secondStart = await context.journal.start()
    assert.equal(secondStart.ok, false)

    const closeResult = await context.journal.close()
    assert.equal(closeResult.ok, true)

    const restart = await context.journal.start()
    assert.equal(restart.ok, false)
  } finally {
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test("rejects startup without a usable event bus", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-invalid-"))
  try {
    const journal = new Journal({ directory })
    const result = await journal.start()
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /valid eventBus is required/)
    assert.equal(journal.started, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})


test("cleans up the file handle when a closed event bus rejects subscription", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-closed-bus-"))
  const eventBus = new EventBus()
  await eventBus.close()
  const journal = new Journal({ eventBus, directory })
  try {
    const result = await journal.start()
    assert.equal(result.ok, false)
    assert.equal(journal.fileHandle, null)
    assert.equal(journal.started, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})


test("rejects an empty directory before creating a session file", async () => {
  const eventBus = new EventBus()
  const journal = new Journal({ eventBus, directory: "   " })
  const result = await journal.start()
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /journal directory is required/)
  assert.equal(journal.fileHandle, null)
  await eventBus.close()
})


test("can close before startup and then rejects startup", async () => {
  const journal = new Journal({ directory: "/unused" })
  const closeResult = await journal.close()
  assert.equal(closeResult.ok, true)
  assert.equal(closeResult.closed, true)
  const startResult = await journal.start()
  assert.equal(startResult.ok, false)
})



test("reports a failed disk sync instead of claiming the journal was flushed", async () => {
  const context = await createTestJournal()

  try {
    context.journal.fileHandle.sync = async () => {
      throw new Error("simulated disk sync failure")
    }

    const result = await context.journal.flush()

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /simulated disk sync failure/)
  } finally {
    // Restore a working sync method so cleanup can complete normally.
    delete context.journal.fileHandle.sync
    await context.journal.close()
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})


test("does not claim a durable close on a repeated close after sync failure", async () => {
  const context = await createTestJournal()
  try {
    context.journal.fileHandle.sync = async () => {
      throw new Error("simulated close sync failure")
    }
    const first = await context.journal.close()
    assert.equal(first.ok, false)
    assert.equal(first.durable, undefined)
    const second = await context.journal.close()
    assert.equal(second.ok, false)
    assert.equal(second.durable, false)
    assert.match(second.errors[0].message, /without durable confirmation/)
  } finally {
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test("reports a failed disk sync during close and still closes the file handle", async () => {
  const context = await createTestJournal()
  const fileHandle = context.journal.fileHandle

  try {
    fileHandle.sync = async () => {
      throw new Error("simulated close sync failure")
    }

    const result = await context.journal.close()

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /simulated close sync failure/)
    assert.equal(context.journal.fileHandle, null)
    assert.equal(context.journal.closed, true)
  } finally {
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})


test("keeps close successful when the shutdown info logger throws", async () => {
  const context = await createTestJournal()

  try {
    context.journal.logger.info = () => {
      throw new Error("simulated logger failure")
    }

    const result = await context.journal.close()

    assert.equal(result.ok, true)
    assert.equal(result.closed, true)
    assert.equal(context.journal.fileHandle, null)
    assert.equal(context.journal.closed, true)
  } finally {
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test("returns close errors even when the error logger throws", async () => {
  const context = await createTestJournal()
  const fileHandle = context.journal.fileHandle

  try {
    fileHandle.sync = async () => {
      throw new Error("simulated close sync failure")
    }
    context.journal.logger.error = () => {
      throw new Error("simulated error logger failure")
    }

    const result = await context.journal.close()

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /simulated close sync failure/)
    assert.equal(context.journal.fileHandle, null)
    assert.equal(context.journal.closed, true)
  } finally {
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})


test("keeps startup successful when the startup info logger throws", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-logger-"))
  const eventBus = new EventBus()
  const logger = {
    info: () => {
      throw new Error("simulated startup logger failure")
    },
    error: () => {
      throw new Error("simulated error logger failure")
    },
  }
  const journal = new Journal({ eventBus, directory, logger })

  try {
    const result = await journal.start()

    assert.equal(result.ok, true)
    assert.equal(journal.started, true)
    assert.ok(journal.fileHandle)

    const closeResult = await journal.close()
    assert.equal(closeResult.ok, true)
    assert.equal(journal.closed, true)
    assert.equal(journal.fileHandle, null)
  } finally {
    await eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})


test("returns a flush error when the event bus flush rejects", async () => {
  const context = await createTestJournal()

  try {
    context.eventBus.flush = async () => {
      throw new Error("simulated event bus flush rejection")
    }

    const result = await context.journal.flush()

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /simulated event bus flush rejection/)
  } finally {
    context.eventBus.flush = EventBus.prototype.flush
    await context.journal.close()
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test("still closes the journal when unsubscribe and event bus flush throw", async () => {
  const context = await createTestJournal()

  try {
    context.journal.subscription.unsubscribe = () => {
      throw new Error("simulated unsubscribe failure")
    }
    context.eventBus.flush = async () => {
      throw new Error("simulated event bus flush rejection")
    }

    const result = await context.journal.close()

    assert.equal(result.ok, false)
    assert.ok(result.errors.some((error) => /simulated unsubscribe failure/.test(error.message)))
    assert.ok(result.errors.some((error) => /simulated event bus flush rejection/.test(error.message)))
    assert.equal(context.journal.fileHandle, null)
    assert.equal(context.journal.closed, true)
    assert.equal(context.journal.subscription, null)
  } finally {
    context.eventBus.flush = EventBus.prototype.flush
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})


test("retries a transient disk sync failure and durably persists records written before and after it", async () => {
  const context = await createTestJournal()
  const originalSync = context.journal.fileHandle.sync.bind(context.journal.fileHandle)
  let syncAttempts = 0

  try {
    context.journal.fileHandle.sync = async () => {
      syncAttempts += 1
      if (syncAttempts === 1) {
        throw new Error("simulated transient disk sync failure")
      }
      return originalSync()
    }

    const first = context.eventBus.publish({
      name: "account.snapshot_captured",
      source: "harvester",
      data: { phase: "RECOVERY", generation: 1, attempt: 1 },
    })
    assert.equal(
      first.ok,
      true,
      "The first recovery audit event must be accepted by the event bus before the transient sync failure is injected.",
    )

    const firstFlush = await context.journal.flush()
    assert.equal(
      firstFlush.ok,
      false,
      "The first flush must report the injected file-sync failure instead of claiming durability.",
    )
    assert.equal(
      firstFlush.durable,
      undefined,
      "A failed file sync must not expose a durable confirmation for the first recovery audit event.",
    )
    assert.match(
      firstFlush.errors[0].message,
      /simulated transient disk sync failure/,
      "The failed flush result must retain the original transient sync failure message.",
    )

    const firstWrittenContent = await readFile(context.filePath, "utf8")
    const firstWrittenRecord = JSON.parse(firstWrittenContent.trim().split("\n")[0])
    assert.equal(
      firstWrittenRecord.__coinzillaJournal.id,
      first.event.id,
      "The first JSONL record must have completed its write before the failed sync is retried.",
    )

    const second = context.eventBus.publish({
      name: "account.snapshot_captured",
      source: "harvester",
      data: { phase: "RECOVERY", generation: 1, attempt: 2 },
    })
    assert.equal(
      second.ok,
      true,
      "The retry audit event must be accepted after the transient sync failure without restarting the Journal.",
    )

    const secondFlush = await context.journal.flush()
    assert.equal(
      secondFlush.ok,
      true,
      "A later flush on the same Journal instance must recover from the transient sync failure.",
    )
    assert.equal(
      secondFlush.durable,
      true,
      "The successful retry flush must confirm durable storage for all completed writes in the session file.",
    )
    assert.equal(
      syncAttempts,
      2,
      "The Journal must attempt one failed sync and one successful retry sync before cleanup.",
    )

    const records = (await readFile(context.filePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    assert.equal(
      records.length,
      2,
      "The later successful sync must preserve both the original uncertain audit record and the retry audit record.",
    )
    assert.deepEqual(
      records.map((record) => record.__coinzillaJournal.id),
      [first.event.id, second.event.id],
      "The Journal must retain both distinct event IDs in their original append order rather than deduplicating or rewriting evidence.",
    )
    assert.deepEqual(
      records.map((record) => record.data.attempt),
      [1, 2],
      "The durable JSONL history must preserve the first and retry audit payloads in publication order.",
    )
  } finally {
    if (context.journal.fileHandle) {
      delete context.journal.fileHandle.sync
    }
    await context.journal.close()
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})


test("delegates writer lifecycle and record persistence to its injected internal store", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-store-injection-"))
  const eventBus = new EventBus()
  const storeCalls = []
  const expectedFilePath = "virtual-journal/session.jsonl"
  const sessionFileName = "2026-11-08_12-30-00.jsonl"
  const sessionContent = `${JSON.stringify({ id: "stored-record", name: "stored.event" })}\n`
  const store = {
    ensureDirectory: async () => storeCalls.push("ensureDirectory"),
    acquireWriter: async () => storeCalls.push("acquireWriter"),
    createSession: async () => {
      storeCalls.push("createSession")
      return { filePath: expectedFilePath }
    },
    append: async (line) => storeCalls.push({ operation: "append", line }),
    sync: async () => storeCalls.push("sync"),
    closeSession: async () => storeCalls.push("closeSession"),
    releaseWriter: async () => storeCalls.push("releaseWriter"),
    listSessions: async () => {
      storeCalls.push("listSessions")
      return [{ name: sessionFileName, isFile: true }]
    },
    statSession: async () => {
      storeCalls.push("statSession")
      return { size: Buffer.byteLength(sessionContent) }
    },
    readSession: async () => {
      storeCalls.push("readSession")
      return Buffer.from(sessionContent)
    },
  }
  const journal = new Journal({
    eventBus,
    directory,
    [JOURNAL_STORE]: store,
  })

  try {
    const startResult = await journal.start()
    assert.equal(
      startResult.ok,
      true,
      "Journal startup must succeed when its injected persistence store completes directory acquisition and session creation.",
    )
    assert.equal(
      startResult.filePath,
      expectedFilePath,
      "The session path returned by Journal must come from the injected store rather than direct filesystem access.",
    )

    const published = eventBus.publish({
      name: "journal.store_delegation_verified",
      source: "unit-test",
      data: { contract: "internal-store" },
    })
    assert.equal(
      published.ok,
      true,
      "The EventBus must accept a source event while Journal delegates persistence to the injected store.",
    )

    const flushResult = await journal.flush()
    assert.equal(
      flushResult.ok,
      true,
      "Journal flush must delegate file-content synchronization to the injected store after draining EventBus and queued writes.",
    )

    const closeResult = await journal.close()
    assert.equal(
      closeResult.ok,
      true,
      "Journal close must close the injected session and release only the writer ownership acquired through that store.",
    )

    const readResult = await journal.read()
    assert.equal(
      readResult.ok,
      true,
      "Journal read must discover and load sessions through the same injected persistence boundary after the writer stops.",
    )
    assert.equal(
      readResult.records[0].id,
      "stored-record",
      "The recovered snapshot must contain the record supplied by the injected store rather than the physical test directory.",
    )

    const replayedIds = []
    const replayResult = await journal.replay({
      handler: async ({ record }) => replayedIds.push(record.id),
    })
    assert.equal(
      replayResult.ok,
      true,
      "Journal replay must validate and replay records obtained through the injected persistence boundary.",
    )
    assert.deepEqual(
      replayedIds,
      ["stored-record"],
      "The replay handler must receive the recovered record supplied by the injected store.",
    )

    assert.deepEqual(
      storeCalls.map((call) => typeof call === "string" ? call : call.operation),
      [
        "ensureDirectory",
        "acquireWriter",
        "createSession",
        "append",
        "sync",
        "sync",
        "closeSession",
        "releaseWriter",
        "listSessions",
        "statSession",
        "readSession",
        "listSessions",
        "statSession",
        "readSession",
      ],
      "The Journal service must delegate writer lifecycle, append, sync, bounded discovery/read, close, and release operations in order.",
    )
    const appendCall = storeCalls.find((call) => typeof call === "object" && call.operation === "append")
    assert.match(
      appendCall.line,
      /journal\\.store_delegation_verified/,
      "The injected store must receive the serialized JSONL record produced from the EventBus source event.",
    )
  } finally {
    await journal.close()
    await eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})
