import assert from "node:assert/strict"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import { configureHarvesterLogging } from "./configure-harvester-logging.js"
import { createHarvesterLogSessionPaths } from "./create-harvester-log-session-paths.js"
import { prepareOptionalJournal } from "../journal/prepare-optional-journal.js"

function createLogger() {
  const transports = new Map()
  return {
    transports,
    addTransport(transport) {
      transports.set(transport.name, transport)
    },
    async removeTransport(name) {
      const transport = transports.get(name)
      if (!transport) return false
      transports.delete(name)
      await transport.close?.()
      return true
    },
    setLevel() {},
  }
}

test("keeps structured logs and Journal records together while cumulative logs stay separate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-session-layout-"))
  const processIdentity = {
    startedAt: "2026-11-09T12:34:56.789Z",
    runtimeSessionId: "session-layout-test",
  }
  const paths = createHarvesterLogSessionPaths({
    directory,
    ...processIdentity,
  })
  const logger = createLogger()
  const eventBus = new EventBus()
  const logging = await configureHarvesterLogging({
    logger,
    directory,
    processIdentity,
  })
  const journal = prepareOptionalJournal({
    eventBus,
    directory,
    processIdentity,
    logger,
  })

  try {
    const debugEntry = {
      timestamp: processIdentity.startedAt,
      level: "debug",
      data: { message: "session debug record" },
    }
    const traceEntry = {
      ...debugEntry,
      level: "trace",
      data: { message: "session trace record" },
    }
    await logger.transports.get("harvester-debug-file").write(debugEntry)
    await logger.transports.get("harvester-trace-file").write(traceEntry)

    const journalReady = await journal.ready
    assert.equal(journalReady.ok, true, "The Journal must start successfully in the current process session directory")
    assert.equal(
      path.dirname(journalReady.filePath),
      paths.sessionDirectory,
      "The Journal JSONL session must be stored beside this process's structured and terminal logs",
    )

    const published = eventBus.publish({
      name: "harvester.session_layout_test",
      source: "harvester",
      data: { runtimeSessionId: processIdentity.runtimeSessionId },
    })
    assert.equal(published.ok, true, "The session-layout event must be accepted for Journal persistence")
    assert.equal((await journal.flush()).ok, true, "The Journal must durably flush its event in the process session directory")

    assert.equal(
      (await readdir(paths.sessionDirectory)).includes("harvester.log"),
      true,
      "The process session directory must contain its short DEBUG filename",
    )
    assert.equal(
      (await readdir(paths.sessionDirectory)).includes("trace.log"),
      true,
      "The process session directory must contain its short TRACE filename",
    )
    assert.equal(
      (await readdir(paths.sessionDirectory)).some((name) => name.endsWith(".jsonl")),
      true,
      "The process session directory must contain the Journal JSONL session",
    )
    assert.deepEqual(
      (await readdir(path.join(directory, "cumulative"))).sort(),
      ["harvester.log", "trace.log"],
      "Cumulative structured histories must remain separate from per-process session directories",
    )
    assert.deepEqual(
      (await readdir(directory)).sort(),
      ["cumulative", "sessions"],
      "The logs root must contain only the cumulative and session group directories",
    )
  } finally {
    await journal.close()
    await eventBus.close()
    await logging.close()
    await rm(directory, { recursive: true, force: true })
  }
})
