import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { EventBus } from "@coinzilla/event-bus"
import { Journal } from "../src/index.js"

async function createTestJournal() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coinzilla-journal-"))

  const logs = []

  const logger = {
    info: (message, context) => logs.push({ level: "info", message, context }),
    error: (message, context) =>
      logs.push({ level: "error", message, context }),
  }

  const eventBus = new EventBus({ logger })
  const journal = new Journal({ eventBus, directory, logger })

  const result = await journal.start()

  assert.equal(result.ok, true)

  return { directory, eventBus, journal, logs, filePath: result.filePath }
}

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

    const event = JSON.parse(lines[0])

    assert.equal(event.id, published.event.id)
    assert.equal(event.name, "order.filled")
    assert.equal(event.data.orderId, "123")
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
      .map((line) => JSON.parse(line))

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
    const event = JSON.parse(content.trim())

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

    assert.ok(context.logs.some(({ message }) => message === "Journal started"))
    assert.ok(context.logs.some(({ message }) => message === "Journal closed"))
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

    assert.equal([first, second].filter((result) => result.ok).length, 1)
    assert.equal([first, second].filter((result) => !result.ok).length, 1)
    assert.equal(journal.started, true)
    assert.equal(journal.starting, false)
    assert.ok(journal.fileHandle)
    assert.equal(eventBus.emitter.eventNames().filter((name) => typeof name === "symbol").length, 1)

    const files = await readdir(directory)
    assert.equal(files.length, 1)

    const closeResult = await journal.close()
    assert.equal(closeResult.ok, true)
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
