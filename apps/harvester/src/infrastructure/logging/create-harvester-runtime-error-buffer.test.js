import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { configureHarvesterLogging } from "./configure-harvester-logging.js"

function createLogger() {
  const transports = new Map()
  return {
    transports,
    addTransport(transport) {
      transports.set(transport.name, transport)
    },
    async removeTransport(name) {
      const transport = transports.get(name)
      if (!transport) {
        return false
      }
      transports.delete(name)
      await transport.close?.()
      return true
    },
    setLevel() {
      return { transports: [...transports.values()] }
    },
  }
}

function createErrorEntry({ message, timestamp } = {}) {
  return {
    timestamp,
    level: "error",
    method: "error",
    data: {
      message,
    },
  }
}

async function createLoggingFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-error-buffer-"))
  const logger = createLogger()
  const logging = await configureHarvesterLogging({
    logger,
    directory,
    processIdentity: {
      startedAt: "2026-11-21T08:00:00.000Z",
      runtimeSessionId: "runtime-session-buffer",
    },
  })
  return { directory, logger, logging }
}

test("registers a session-scoped ERROR transport before relational persistence is ready", async () => {
  const fixture = await createLoggingFixture()
  try {
    assert.equal(
      fixture.logger.transports.get("harvester-runtime-error-buffer").level,
      "error",
    )
    assert.equal(typeof fixture.logging.errorBuffer.transport.write, "function")
  } finally {
    await fixture.logging.close()
    await rm(fixture.directory, {
      recursive: true,
      force: true,
    })
  }
})

test("buffers startup errors and streams later errors through one exactly-once handoff", async () => {
  const fixture = await createLoggingFixture()
  try {
    const first = createErrorEntry({ message: "Startup error", timestamp: "2026-11-21T08:00:01.000Z" })
    const second = createErrorEntry({ message: "Runtime error", timestamp: "2026-11-21T08:00:02.000Z" })
    fixture.logging.errorBuffer.transport.write(first)
    const persisted = []
    const activation = fixture.logging.errorBuffer.activate((entry) => persisted.push(entry))
    assert.equal(activation.bufferedCount, 1)
    fixture.logging.errorBuffer.transport.write(second)
    assert.deepEqual(persisted, [first, second])
    assert.deepEqual(fixture.logging.errorBuffer.getDiagnostics(), {
      bufferedCount: 0,
      droppedCount: 0,
      active: true,
      closed: false,
    })
  } finally {
    await fixture.logging.close()
    await rm(fixture.directory, {
      recursive: true,
      force: true,
    })
  }
})

test("bounds the pre-database buffer and counts dropped ERROR records", async () => {
  const fixture = await createLoggingFixture()
  try {
    for (let index = 0; index < 10001; index += 1) {
      fixture.logging.errorBuffer.transport.write(
        createErrorEntry({ message: "Buffered startup error", timestamp: "2026-11-21T08:00:01.000Z" }),
      )
    }
    fixture.logging.errorBuffer.transport.write({
      timestamp: "2026-11-21T08:00:02.000Z",
      level: "info",
      method: "info",
      data: { message: "Not an error" },
    })
    assert.deepEqual(fixture.logging.errorBuffer.getDiagnostics(), {
      bufferedCount: 10000,
      droppedCount: 1,
      active: false,
      closed: false,
    })
  } finally {
    await fixture.logging.close()
    await rm(fixture.directory, {
      recursive: true,
      force: true,
    })
  }
})
