import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { createHarvesterLogSessionPaths } from "./create-harvester-log-session-paths.js"

test("groups every process log destination under one UTC session directory", () => {
  const paths = createHarvesterLogSessionPaths({
    directory: "/tmp/harvester-logs",
    startedAt: "2026-11-09T12:34:56.789Z",
    runtimeSessionId: "runtime/session:123",
  })
  const sessionDirectory = path.join(
    "/tmp/harvester-logs",
    "sessions",
    "2026-11-09_12-34-56-runtime-session-123",
  )

  assert.deepEqual(paths, {
    sessionDirectory,
    debug: path.join(sessionDirectory, "harvester.log"),
    trace: path.join(sessionDirectory, "trace.log"),
    terminal: path.join(sessionDirectory, "terminal.log"),
  }, "DEBUG, TRACE and terminal destinations must use short filenames inside the same sanitized UTC session directory")
  assert.equal(Object.isFrozen(paths), true, "Callers must not be able to mutate the resolved process log paths")
})

test("rejects incomplete session identity rather than generating ambiguous directories", () => {
  assert.throws(
    () => createHarvesterLogSessionPaths({
      directory: "/tmp/logs",
      startedAt: "invalid",
      runtimeSessionId: "id",
    }),
    /timestamp/,
    "An invalid process start time must not produce an ambiguous session directory",
  )
  assert.throws(
    () => createHarvesterLogSessionPaths({
      directory: "/tmp/logs",
      startedAt: "2026-11-09T12:34:56.000Z",
      runtimeSessionId: "",
    }),
    /session ID/,
    "A missing runtime session ID must not produce a directory that could mix two process runs",
  )
})
