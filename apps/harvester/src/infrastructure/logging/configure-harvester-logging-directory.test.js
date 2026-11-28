import assert from "node:assert/strict"
import { mkdtemp, readdir, rm } from "node:fs/promises"
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

test("creates missing logs root and process-session directories", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "harvester-missing-logs-"))
  const directory = path.join(temporaryRoot, "missing", "logs")
  const logger = createLogger()
  t.after(() => rm(temporaryRoot, {
    recursive: true,
    force: true,
  }))

  const logging = await configureHarvesterLogging({
    logger,
    directory,
    processIdentity: {
      startedAt: "2026-11-22T12:00:00.000Z",
      runtimeSessionId: "missing-logs-session",
    },
  })
  const entry = {
    timestamp: "2026-11-22T12:00:00.000Z",
    level: "info",
    method: "info",
    context: {
      runtimeSessionId: "missing-logs-session",
    },
    data: {
      message: "directory creation test",
    },
  }
  await logger.transports.get("harvester-debug-file").write(entry)
  await logger.transports.get("harvester-trace-file").write(entry)

  assert.deepEqual(
    (await readdir(directory)).sort(),
    ["cumulative", "sessions"],
  )
  assert.deepEqual(
    (await readdir(path.join(directory, "sessions", "2026-11-22_12-00-00-missing-logs-session"))).sort(),
    ["harvester.log", "process-identity.json", "trace.log"],
  )
  await logging.close()
})
