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

  journal.store.createSession = async () => {
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

test("uses the supplied process identity in its exclusive session filename", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-process-identity-"))
  const eventBus = new EventBus()
  const journal = new Journal({
    eventBus,
    directory,
    sessionIdentity: {
      startedAt: "2026-11-09T12:34:56.789Z",
      runtimeSessionId: "runtime/session:123",
    },
  })

  try {
    const started = await journal.start()
    assert.equal(started.ok, true)
    assert.equal(
      path.basename(started.filePath),
      "2026-11-09_12-34-56-runtime-session-123.jsonl",
      "Journal session filename must share the process UTC timestamp and sanitized runtime ID",
    )
    assert.ok((await readdir(directory)).includes(path.basename(started.filePath)))
    assert.equal((await journal.close()).ok, true)

    const duplicateEventBus = new EventBus()
    const duplicateJournal = new Journal({
      eventBus: duplicateEventBus,
      directory,
      sessionIdentity: {
        startedAt: "2026-11-09T12:34:56.789Z",
        runtimeSessionId: "runtime/session:123",
      },
    })
    try {
      const duplicateStart = await duplicateJournal.start()
      assert.equal(duplicateStart.ok, false, "a repeated process identity must fail exclusive session creation")
      assert.match(duplicateStart.errors[0].message, /EEXIST/)
      assert.ok((await readdir(directory)).includes(path.basename(started.filePath)))
    } finally {
      await duplicateJournal.close()
      await duplicateEventBus.close()
    }
  } finally {
    await journal.close()
    await eventBus.close()
    await rm(directory, { recursive: true, force: true })
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


test("rejects invalid records and makes serialization failure visible to flush and close", async () => {
  const context = await createTestJournal()

  try {
    const result = await context.journal.record({
      event: {
        id: "event-invalid-nested-value",
        name: "journal.invalid_value",
        data: { nested: { value: undefined } },
      },
    })

    assert.equal(result.ok, false, "record() must reject a source event containing a nested undefined value.")
    assert.equal(context.journal.writeFailed, true, "A serialization failure must poison the active writer so later events cannot silently follow an omitted event.")
    assert.equal(context.journal.writeErrors.length, 1, "The original serialization failure must be retained for lifecycle durability results.")

    const subsequentResult = await context.journal.record({
      event: { id: "event-after-invalid", name: "journal.valid", data: { value: "valid" } },
    })
    assert.equal(subsequentResult.ok, false, "The writer must reject later records after a source event could not be serialized losslessly.")

    const flushResult = await context.journal.flush()
    assert.equal(flushResult.ok, false, "flush() must not report durable success after a source event was omitted.")
    assert.match(flushResult.errors[0].message, /undefined/, "flush() must expose the original nested serialization failure.")

    assert.equal(await readFile(context.filePath, "utf8"), "", "A rejected source event must not append a lossy or partial JSONL line.")

    const closeResult = await context.journal.close()
    assert.equal(closeResult.ok, false, "close() must retain the failed durability outcome after serialization failure.")
    assert.equal(closeResult.durable, false, "close() must never claim durable closure after a source event was omitted.")
    assert.equal(context.journal.closeDurable, false, "The Journal's observable closeDurable state must remain false after serialization failure.")
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
      journal.store.sessionHandle,
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

test("waits for startup cancellation to release the writer lock before close resolves", async () => {
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
  const originalCreateSession = journal.store.createSession.bind(journal.store)
  journal.store.createSession = async () => {
    signalCreateSessionFileStarted()
    await createSessionFileGate
    return originalCreateSession()
  }

  let startPromise
  let closePromise
  try {
    startPromise = journal.start()
    await createSessionFileStarted

    let closeSettled = false
    closePromise = journal.close().then((result) => {
      closeSettled = true
      return result
    })

    await Promise.resolve()
    assert.equal(
      closeSettled,
      false,
      "Close must remain pending while startup still owns a writer lock and session creation has not completed its cancellation cleanup.",
    )

    releaseCreateSessionFile()
    const startResult = await startPromise
    const closeResult = await closePromise

    assert.equal(
      startResult.ok,
      false,
      "Startup must report cancellation when close is requested before the session has become active.",
    )
    assert.match(
      startResult.errors[0].message,
      /closed during startup/,
      "The startup result must identify that close cancelled the in-flight startup attempt.",
    )
    assert.equal(
      closeResult.ok,
      true,
      "Close must report success after the cancelled startup attempt has released all resources it acquired.",
    )
    assert.equal(
      journal.closed,
      true,
      "The Journal must enter its terminal closed state after startup cancellation has settled.",
    )
    assert.equal(
      journal.store.sessionHandle,
      null,
      "No session file handle may remain open when close reports completion after startup cancellation.",
    )
    const remainingFiles = await readdir(directory)
    assert.equal(
      remainingFiles.includes(".coinzilla-journal.lock"),
      false,
      "The cancelled startup must release its exclusive writer lock before close resolves.",
    )
    const retainedSessions = remainingFiles.filter((fileName) => fileName.endsWith(".jsonl"))
    assert.equal(
      retainedSessions.length,
      1,
      "The session file created before startup cancellation must remain as an empty historical session rather than being deleted.",
    )
    assert.equal(
      await readFile(path.join(directory, retainedSessions[0]), "utf8"),
      "",
      "The retained session file must remain empty because startup was cancelled before any event could be accepted.",
    )
  } finally {
    releaseCreateSessionFile()
    await Promise.allSettled([startPromise, closePromise].filter(Boolean))
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
    assert.equal(journal.store.sessionHandle, null)
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
  assert.equal(journal.store.sessionHandle, null)
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



test("poisons the writer after append failure and releases owned resources on close", async () => {
  const context = await createTestJournal()
  let appendCalls = 0
  let syncCalls = 0
  let partialContent = ""
  const appendError = new Error("simulated append failure")

  context.journal.store.append = async (line) => {
    appendCalls += 1
    partialContent = line.slice(0, Math.floor(line.length / 2))
    await context.journal.store.sessionHandle.writeFile(partialContent, "utf8")
    throw appendError
  }
  context.journal.store.sync = async () => {
    syncCalls += 1
  }

  try {
    const first = await context.journal.record({
      event: { id: "append-failed", name: "journal.append_failure" },
    })
    assert.equal(
      first.ok,
      false,
      "The record whose append fails must report the original storage error.",
    )
    assert.equal(
      first.errors[0],
      appendError,
      "The first failed append must preserve the original adapter error object.",
    )
    assert.ok(partialContent.length > 0, "The injected failure must occur after a non-empty prefix reaches the session file.")
    assert.equal(
      await readFile(context.filePath, "utf8"),
      partialContent,
      "The deterministic append failure must leave the exact prefix already written to the session file.",
    )

    const second = await context.journal.record({
      event: { id: "append-after-failure", name: "journal.append_after_failure" },
    })
    assert.equal(
      second.ok,
      false,
      "A writer with an uncertain failed append must reject later records.",
    )
    assert.match(
      second.errors[0].message,
      /session is failed after a previous write error/,
      "Subsequent records must report the poisoned writer state rather than retrying an uncertain append.",
    )
    assert.equal(
      appendCalls,
      1,
      "The adapter must not be called again after the first append failure poisons the writer.",
    )

    const flushed = await context.journal.flush()
    assert.equal(
      flushed.ok,
      false,
      "Flush must not claim durability after a failed append.",
    )
    assert.match(
      flushed.errors[0].message,
      /simulated append failure/,
      "Flush must retain the original append error.",
    )
    assert.equal(
      syncCalls,
      0,
      "Flush must not sync and claim a healthy write queue after an append failure.",
    )

    const closed = await context.journal.close()
    assert.equal(
      closed.ok,
      false,
      "Close must preserve the failed append outcome rather than claiming durable closure.",
    )
    assert.equal(
      context.journal.closed,
      true,
      "The failed writer must still reach the stopped lifecycle state after cleanup.",
    )
    assert.equal(
      context.journal.store.sessionHandle,
      null,
      "Close must release the session handle even when an append failed.",
    )
    assert.equal(
      syncCalls,
      1,
      "Close must still attempt its final file-content sync before releasing the session.",
    )
    const remainingFiles = await readdir(context.directory)
    assert.equal(
      remainingFiles.some((name) => name.endsWith(".lock")),
      false,
      "Close must release the directory lock owned by the failed writer.",
    )
    assert.equal(
      await readFile(context.filePath, "utf8"),
      partialContent,
      "Close must preserve the exact partial bytes from the failed append without truncating, rewriting, or repairing the session file.",
    )
  } finally {
    await context.journal.close()
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test("reports a failed disk sync instead of claiming the journal was flushed", async () => {
  const context = await createTestJournal()

  try {
    context.journal.store.sync = async () => {
      throw new Error("simulated disk sync failure")
    }

    const result = await context.journal.flush()

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /simulated disk sync failure/)
  } finally {
    // Restore a working sync method so cleanup can complete normally.
    delete context.journal.store.sync
    await context.journal.close()
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})


test("does not claim a durable close on a repeated close after sync failure", async () => {
  const context = await createTestJournal()
  try {
    context.journal.store.sync = async () => {
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
  
  try {
    context.journal.store.sync = async () => {
      throw new Error("simulated close sync failure")
    }

    const result = await context.journal.close()

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /simulated close sync failure/)
    assert.equal(context.journal.store.sessionHandle, null)
    assert.equal(context.journal.closed, true)
  } finally {
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})


test("keeps close successful when the shutdown system logger throws", async () => {
  const context = await createTestJournal()

  try {
    let systemLogCalls = 0
    context.journal.logger.system = () => {
      systemLogCalls += 1
      throw new Error("simulated logger failure")
    }

    const result = await context.journal.close()

    assert.equal(result.ok, true)
    assert.equal(result.closed, true)
    assert.equal(systemLogCalls, 1, "The shutdown system logger must be invoked exactly once even when its failure is isolated.")
    assert.equal(context.journal.store.sessionHandle, null)
    assert.equal(context.journal.closed, true)
  } finally {
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test("returns close errors even when the error logger throws", async () => {
  const context = await createTestJournal()
  
  try {
    context.journal.store.sync = async () => {
      throw new Error("simulated close sync failure")
    }
    context.journal.logger.error = () => {
      throw new Error("simulated error logger failure")
    }

    const result = await context.journal.close()

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /simulated close sync failure/)
    assert.equal(context.journal.store.sessionHandle, null)
    assert.equal(context.journal.closed, true)
  } finally {
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})


test("keeps startup successful when the startup system logger throws", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-logger-"))
  const eventBus = new EventBus()
  let systemLogCalls = 0
  const logger = {
    system: () => {
      systemLogCalls += 1
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
    assert.equal(systemLogCalls, 1, "The startup system logger must be invoked exactly once even when its failure is isolated.")
    assert.equal(journal.started, true)
    assert.ok(journal.store.sessionHandle)

    const closeResult = await journal.close()
    assert.equal(closeResult.ok, true)
    assert.equal(journal.closed, true)
    assert.equal(journal.store.sessionHandle, null)
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
    assert.equal(context.journal.store.sessionHandle, null)
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
  const originalSync = context.journal.store.sync.bind(context.journal.store)
  let syncAttempts = 0

  try {
    context.journal.store.sync = async () => {
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
    if (context.journal.store.sessionHandle) {
      delete context.journal.store.sync
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
    assert.equal(
      appendCall.line.includes("journal.store_delegation_verified"),
      true,
      "The injected store must receive the serialized JSONL record produced from the EventBus source event.",
    )  } finally {
    await journal.close()
    await eventBus.close()
    await rm(directory, { recursive: true, force: true })
  }
})


test("keeps the legacy internal file-handle override forwarded to the store-owned session handle", async () => {
  const eventBus = new EventBus()
  const store = { sessionHandle: null }
  const journal = new Journal({
    eventBus,
    directory: "unused-by-store-alias-test",
    [JOURNAL_STORE]: store,
  })
  const replacementHandle = {
    writeFile: async () => {},
    sync: async () => {},
    close: async () => {},
  }

  try {
    journal.fileHandle = replacementHandle
    assert.equal(
      store.sessionHandle,
      replacementHandle,
      "The legacy internal fileHandle override must update the session handle owned by the injected persistence store.",
    )
    assert.equal(
      journal.fileHandle,
      replacementHandle,
      "The deprecated internal accessor must continue to expose the same handle for existing package-level failure-injection tests.",
    )
  } finally {
    await eventBus.close()
  }
})



test("rejects a concurrent close without starting a second EventBus flush", async () => {
  const eventBus = new EventBus()
  const storeCalls = []
  const store = {
    ensureDirectory: async () => storeCalls.push("ensureDirectory"),
    acquireWriter: async () => storeCalls.push("acquireWriter"),
    createSession: async () => {
      storeCalls.push("createSession")
      return { filePath: "virtual-journal/session.jsonl" }
    },
    append: async () => storeCalls.push("append"),
    sync: async () => storeCalls.push("sync"),
    closeSession: async () => storeCalls.push("closeSession"),
    releaseWriter: async () => storeCalls.push("releaseWriter"),
  }
  const journal = new Journal({
    eventBus,
    directory: "virtual-journal",
    [JOURNAL_STORE]: store,
  })

  let releaseFirstFlush
  let signalFirstFlushStarted
  const firstFlushStarted = new Promise((resolve) => {
    signalFirstFlushStarted = resolve
  })
  const firstFlushGate = new Promise((resolve) => {
    releaseFirstFlush = resolve
  })
  let flushCalls = 0
  eventBus.flush = async () => {
    flushCalls += 1
    if (flushCalls === 1) {
      signalFirstFlushStarted()
      await firstFlushGate
    }
    return { ok: true, errors: [] }
  }

  let firstClosePromise
  let secondClosePromise
  try {
    const startResult = await journal.start()
    assert.equal(
      startResult.ok,
      true,
      "The Journal must become active before the test holds its first shutdown flush.",
    )

    firstClosePromise = journal.close()
    await firstFlushStarted

    secondClosePromise = journal.close()
    assert.equal(
      flushCalls,
      1,
      "A concurrent close attempt must be rejected before it invokes a second EventBus flush while the first close is still draining.",
    )

    const secondCloseResult = await secondClosePromise
    assert.equal(
      secondCloseResult.ok,
      false,
      "The second close call must report that another close operation already owns shutdown.",
    )
    assert.match(
      secondCloseResult.errors[0].message,
      /already closing/,
      "The concurrent close failure must preserve the existing already-closing result contract.",
    )

    releaseFirstFlush()
    const firstCloseResult = await firstClosePromise
    assert.equal(
      firstCloseResult.ok,
      true,
      "The first close operation must finish successfully after the in-flight EventBus flush is released.",
    )
    assert.equal(
      flushCalls,
      1,
      "Exactly one EventBus flush must participate in a single active Journal close operation.",
    )
    assert.deepEqual(
      storeCalls,
      ["ensureDirectory", "acquireWriter", "createSession", "sync", "closeSession", "releaseWriter"],
      "Only the close operation that owns shutdown may sync and release the session and writer resources.",
    )
    assert.equal(
      journal.closed,
      true,
      "The owning close operation must leave the Journal in its terminal closed state.",
    )
  } finally {
    releaseFirstFlush()
    await Promise.allSettled([firstClosePromise, secondClosePromise].filter(Boolean))
    eventBus.flush = EventBus.prototype.flush
    await eventBus.close()
  }
})


test("waits for an active flush before closing the session and rejects flushes after close claims shutdown", async () => {
  const eventBus = new EventBus()
  const storeCalls = []
  let activeSyncs = 0
  let syncCalls = 0
  let concurrentSync = false
  let closeWhileSyncActive = false
  let releaseFirstSync
  let signalFirstSyncStarted
  const firstSyncStarted = new Promise((resolve) => {
    signalFirstSyncStarted = resolve
  })
  const firstSyncGate = new Promise((resolve) => {
    releaseFirstSync = resolve
  })
  const store = {
    ensureDirectory: async () => storeCalls.push("ensureDirectory"),
    acquireWriter: async () => storeCalls.push("acquireWriter"),
    createSession: async () => {
      storeCalls.push("createSession")
      return { filePath: "virtual-journal/session.jsonl" }
    },
    append: async () => storeCalls.push("append"),
    sync: async () => {
      syncCalls += 1
      activeSyncs += 1
      if (activeSyncs > 1) {
        concurrentSync = true
        activeSyncs -= 1
        throw new Error("Journal session sync operations must not overlap.")
      }
      try {
        if (syncCalls === 1) {
          signalFirstSyncStarted()
          await firstSyncGate
        }
        storeCalls.push("sync")
      } finally {
        activeSyncs -= 1
      }
    },
    closeSession: async () => {
      closeWhileSyncActive ||= activeSyncs > 0
      storeCalls.push("closeSession")
    },
    releaseWriter: async () => storeCalls.push("releaseWriter"),
  }
  const journal = new Journal({
    eventBus,
    directory: "virtual-journal",
    [JOURNAL_STORE]: store,
  })
  const originalFlush = eventBus.flush.bind(eventBus)
  let busFlushCalls = 0
  eventBus.flush = async () => {
    busFlushCalls += 1
    return { ok: true, errors: [] }
  }

  let flushPromise
  let closePromise
  try {
    const startResult = await journal.start()
    assert.equal(
      startResult.ok,
      true,
      "The Journal must be active before the test holds a flush inside the session sync boundary.",
    )

    flushPromise = journal.flush()
    await firstSyncStarted

    closePromise = journal.close()
    const flushDuringClose = await journal.flush()
    assert.equal(
      flushDuringClose.ok,
      false,
      "A new flush must be rejected as soon as close owns shutdown, before the later record-admission cutoff.",
    )
    assert.equal(
      flushDuringClose.errors[0].message,
      "Journal must be started to flush durable records",
      "A flush rejected by close ownership must return the normal stopped/closing guard error, not reach storage.",
    )
    assert.equal(
      syncCalls,
      1,
      "Close must wait for the already-running flush rather than starting a concurrent final session sync.",
    )
    assert.equal(
      busFlushCalls,
      1,
      "Close must wait for the active flush before starting its own final EventBus drain.",
    )

    releaseFirstSync()
    const flushResult = await flushPromise
    const closeResult = await closePromise

    assert.equal(
      flushResult.ok,
      true,
      "The flush that began before close claimed shutdown must finish successfully.",
    )
    assert.equal(
      closeResult.ok,
      true,
      "Close must complete successfully after the active flush has settled and its own final drain and sync have completed.",
    )
    assert.equal(
      concurrentSync,
      false,
      "The Journal must never issue overlapping session sync operations when flush and close overlap.",
    )
    assert.equal(
      closeWhileSyncActive,
      false,
      "The session handle must not be closed while an earlier flush still owns an active sync operation.",
    )
    assert.equal(
      syncCalls,
      2,
      "The lifecycle must perform exactly one sync for the explicit flush and one final sync for close.",
    )
    assert.equal(
      busFlushCalls,
      2,
      "The close operation must perform one final EventBus drain after the earlier flush has completed.",
    )
    assert.deepEqual(
      storeCalls,
      ["ensureDirectory", "acquireWriter", "createSession", "sync", "sync", "closeSession", "releaseWriter"],
      "The active flush must finish before the owning close performs its final sync, session close, and writer release.",
    )
    assert.equal(
      journal.closed,
      true,
      "The Journal must reach its terminal closed state after flush/close serialization.",
    )
  } finally {
    releaseFirstSync()
    await Promise.allSettled([flushPromise, closePromise].filter(Boolean))
    eventBus.flush = originalFlush
    await eventBus.close()
  }
})



test("serializes concurrent explicit flushes across EventBus drain and session sync", async () => {
  const eventBus = new EventBus()
  const storeCalls = []
  let activeSyncs = 0
  let maxActiveSyncs = 0
  let syncCalls = 0
  let busFlushCalls = 0
  let releaseFirstSync
  let signalFirstSyncStarted
  const firstSyncStarted = new Promise((resolve) => {
    signalFirstSyncStarted = resolve
  })
  const firstSyncGate = new Promise((resolve) => {
    releaseFirstSync = resolve
  })
  const store = {
    ensureDirectory: async () => storeCalls.push("ensureDirectory"),
    acquireWriter: async () => storeCalls.push("acquireWriter"),
    createSession: async () => {
      storeCalls.push("createSession")
      return { filePath: "virtual-journal/session.jsonl" }
    },
    append: async () => storeCalls.push("append"),
    sync: async () => {
      syncCalls += 1
      activeSyncs += 1
      maxActiveSyncs = Math.max(maxActiveSyncs, activeSyncs)
      try {
        if (syncCalls === 1) {
          signalFirstSyncStarted()
          await firstSyncGate
        }
        storeCalls.push("sync")
      } finally {
        activeSyncs -= 1
      }
    },
    closeSession: async () => storeCalls.push("closeSession"),
    releaseWriter: async () => storeCalls.push("releaseWriter"),
  }
  const journal = new Journal({
    eventBus,
    directory: "virtual-journal",
    [JOURNAL_STORE]: store,
  })
  eventBus.flush = async () => {
    busFlushCalls += 1
    storeCalls.push("busFlush")
    return { ok: true, errors: [] }
  }

  let firstFlush
  let secondFlush
  let closePromise
  try {
    const started = await journal.start()
    assert.equal(started.ok, true)

    firstFlush = journal.flush()
    await firstSyncStarted
    secondFlush = journal.flush()

    await Promise.resolve()
    assert.equal(
      busFlushCalls,
      1,
      "A second explicit flush must wait before starting another EventBus drain while the first flush is active.",
    )
    assert.equal(
      syncCalls,
      1,
      "A second explicit flush must not enter the session sync boundary while the first sync is held.",
    )
    assert.equal(
      activeSyncs,
      1,
      "At most one explicit flush may own a session sync operation.",
    )

    releaseFirstSync()
    const [firstResult, secondResult] = await Promise.all([firstFlush, secondFlush])
    assert.equal(firstResult.ok, true)
    assert.equal(secondResult.ok, true)
    assert.equal(busFlushCalls, 2)
    assert.equal(syncCalls, 2)
    assert.equal(maxActiveSyncs, 1)
    assert.deepEqual(
      storeCalls,
      [
        "ensureDirectory",
        "acquireWriter",
        "createSession",
        "busFlush",
        "sync",
        "busFlush",
        "sync",
      ],
      "Each explicit flush must finish its full drain-and-sync lifecycle before the next begins.",
    )
  } finally {
    releaseFirstSync()
    await Promise.allSettled([firstFlush, secondFlush].filter(Boolean))
    closePromise = journal.close()
    await closePromise
    await eventBus.close()
  }
})


test("close drains a published event before releasing the session and writer lock", async () => {
  const context = await createTestJournal()
  let signalAppendStarted
  let releaseAppend
  const appendStarted = new Promise((resolve) => {
    signalAppendStarted = resolve
  })
  const appendGate = new Promise((resolve) => {
    releaseAppend = resolve
  })
  const originalAppend = context.journal.store.append.bind(context.journal.store)
  context.journal.store.append = async (line) => {
    signalAppendStarted()
    await appendGate
    return originalAppend(line)
  }

  let closePromise
  try {
    const published = context.eventBus.publish({
      name: "journal.close_publish_race",
      source: "unit-test",
      data: { admission: "before-close" },
    })
    assert.equal(
      published.ok,
      true,
      "The EventBus must accept the source event before close claims shutdown.",
    )

    let closeSettled = false
    closePromise = context.journal.close().then((result) => {
      closeSettled = true
      return result
    })

    await appendStarted
    await Promise.resolve()
    assert.equal(
      closeSettled,
      false,
      "Close must remain pending while the already-published event is still being appended to the session.",
    )
    assert.ok(
      context.journal.store.sessionHandle,
      "The session handle must remain owned and open while an admitted publish is still being persisted.",
    )
    assert.ok(
      (await readdir(context.directory)).includes(".coinzilla-journal.lock"),
      "The exclusive writer lock must remain owned while an admitted publish is still being persisted.",
    )

    releaseAppend()
    const closeResult = await closePromise
    assert.equal(
      closeResult.ok,
      true,
      "Close must finish successfully after the admitted event append, final sync, and resource cleanup complete.",
    )
    assert.equal(
      closeResult.durable,
      true,
      "Close may report durable completion only after the admitted event has been synchronized.",
    )
    assert.equal(
      context.journal.store.sessionHandle,
      null,
      "The session handle must be released after the admitted event has been drained and synchronized.",
    )
    assert.equal(
      (await readdir(context.directory)).includes(".coinzilla-journal.lock"),
      false,
      "The exclusive writer lock must be released only after the admitted event has been drained and durably synchronized.",
    )

    const lines = (await readFile(context.filePath, "utf8")).trim().split("\n")
    assert.equal(
      lines.length,
      1,
      "The close/publish race must preserve exactly the one event admitted before shutdown.",
    )
    const stored = JSON.parse(lines[0])
    assert.equal(
      stored.__coinzillaJournal.id,
      published.event.id,
      "The durable session record must retain the exact identity assigned to the event accepted before close.",
    )
    assert.equal(
      stored.name,
      "journal.close_publish_race",
      "The durable session must preserve the source event that was published immediately before close.",
    )
    assert.equal(
      stored.data.admission,
      "before-close",
      "The durable record must preserve the admitted event payload without mutation.",
    )
  } finally {
    releaseAppend()
    await Promise.allSettled([closePromise].filter(Boolean))
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})


test("finishes previously accepted queued writes before reporting a later serialization failure", async () => {
  const context = await createTestJournal()

  try {
    const acceptedWrite = context.journal.record({
      event: {
        id: "event-accepted-before-serialization-failure",
        name: "order.created",
        data: { orderId: "42" },
      },
    })
    const rejectedWrite = context.journal.record({
      event: {
        id: "event-rejected-after-accepted-write",
        name: "order.updated",
        data: { amount: undefined },
      },
    })

    const [acceptedResult, rejectedResult] = await Promise.all([acceptedWrite, rejectedWrite])
    assert.equal(
      acceptedResult.ok,
      true,
      "A valid record accepted before a later serialization failure must still finish its queued append.",
    )
    assert.equal(
      rejectedResult.ok,
      false,
      "The later source event with an undefined nested value must be rejected before it enters the write queue.",
    )

    const flushResult = await context.journal.flush()
    assert.equal(
      flushResult.ok,
      false,
      "The session must remain non-durable overall because a later source event was omitted.",
    )

    const lines = (await readFile(context.filePath, "utf8")).trim().split("\n")
    assert.equal(
      lines.length,
      1,
      "Previously accepted writes must remain in the session even though a later serialization failure poisons new record admission.",
    )
    assert.equal(
      JSON.parse(lines[0]).id,
      "event-accepted-before-serialization-failure",
      "The completed queued record must retain its original event identity and append order.",
    )

    const closeResult = await context.journal.close()
    assert.equal(closeResult.ok, false, "Close must expose the later serialization failure after draining accepted writes.")
    assert.equal(closeResult.durable, false, "The session must not report durable closure while an event was omitted.")
  } finally {
    await context.journal.close()
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test("does not report durable success when the real EventBus delivers JSON-lossy values", async () => {
  const cyclicData = {}
  cyclicData.self = cyclicData

  const sparseArray = []
  sparseArray.length = 2
  sparseArray[1] = "present"

  const invalidPayloads = [
    { label: "BigInt", data: { amount: 1n } },
    { label: "cyclic graph", data: { nested: cyclicData } },
    { label: "undefined object property", data: { nested: { amount: undefined } } },
    { label: "undefined array entry", data: { amounts: [1, undefined] } },
    { label: "sparse array hole", data: { amounts: sparseArray } },
    { label: "NaN", data: { amount: NaN } },
    { label: "positive infinity", data: { amount: Infinity } },
    { label: "negative infinity", data: { amount: -Infinity } },
    { label: "negative zero", data: { amount: -0 } },
  ]

  for (const invalidPayload of invalidPayloads) {
    const context = await createTestJournal()

    try {
      const published = context.eventBus.publish({
        name: "journal.lossy_payload",
        source: "journal-integration-test",
        data: invalidPayload.data,
      })

      assert.equal(
        published.ok,
        true,
        `The broader EventBus in-memory contract must accept the ${invalidPayload.label} fixture so the real Journal subscriber path is exercised.`,
      )

      const busFlush = await context.eventBus.flush()
      assert.equal(
        busFlush.ok,
        true,
        `EventBus delivery should settle normally for ${invalidPayload.label}; Journal owns the stricter persistence contract.`,
      )

      const journalFlush = await context.journal.flush()
      assert.equal(
        journalFlush.ok,
        false,
        `Journal flush must fail when a delivered ${invalidPayload.label} cannot be persisted losslessly.`,
      )
      assert.equal(
        context.journal.writeFailed,
        true,
        `A delivered ${invalidPayload.label} that cannot be serialized must poison the Journal writer.`,
      )
      assert.equal(
        context.journal.writeErrors.length,
        1,
        `Journal must retain the original ${invalidPayload.label} serialization failure for flush and close.`,
      )

      const closeResult = await context.journal.close()
      assert.equal(
        closeResult.ok,
        false,
        `Journal close must remain failed after the subscriber rejects a ${invalidPayload.label} event.`,
      )
      assert.equal(
        closeResult.durable,
        false,
        `Journal close must not claim durable closure after omitting a ${invalidPayload.label} event.`,
      )
      assert.equal(
        context.journal.closeDurable,
        false,
        `Journal closeDurable must remain false after a ${invalidPayload.label} serialization failure.`,
      )
      assert.equal(
        await readFile(context.filePath, "utf8"),
        "",
        `The ${invalidPayload.label} source event must be rejected before any JSONL bytes are appended.`,
      )
    } finally {
      await context.journal.close()
      await context.eventBus.close()
      await rm(context.directory, { recursive: true, force: true })
    }
  }
})

test("persists shared EventBus references as repeated values without preserving identity", async () => {
  const context = await createTestJournal()
  const shared = { orderId: "shared-order-42" }

  try {
    const published = context.eventBus.publish({
      name: "journal.shared_reference",
      source: "journal-integration-test",
      data: { first: shared, second: shared },
    })

    assert.equal(published.ok, true, "EventBus must accept a shared reference as part of its in-memory payload graph.")

    const flushResult = await context.journal.flush()
    assert.equal(flushResult.ok, true, "Journal must accept repeated shared references when each repeated subtree is losslessly JSON-safe.")

    const closeResult = await context.journal.close()
    assert.equal(closeResult.ok, true, "A session containing a JSON-safe shared reference must close durably.")
    assert.equal(closeResult.durable, true, "Shared-reference aliasing must not prevent durable JSONL persistence.")

    const readResult = await context.journal.read()
    assert.equal(readResult.ok, true, "The persisted shared-reference record must remain readable after close.")
    assert.deepEqual(
      readResult.records[0].payload.data,
      { first: { orderId: "shared-order-42" }, second: { orderId: "shared-order-42" } },
      "The recovered payload must retain the value of both references.",
    )
    assert.notStrictEqual(
      readResult.records[0].payload.data.first,
      readResult.records[0].payload.data.second,
      "JSONL persistence must explicitly exclude shared object-identity preservation.",
    )
  } finally {
    await context.journal.close()
    await context.eventBus.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})
