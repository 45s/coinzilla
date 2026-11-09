import test from "node:test"
import assert from "node:assert/strict"
import { createHarvesterLogSessionPaths } from "./create-harvester-log-session-paths.js"

test("creates three filenames sharing one UTC timestamp and runtime session ID", () => {
  const paths = createHarvesterLogSessionPaths({ directory: "/tmp/harvester-logs", startedAt: "2026-11-09T12:34:56.789Z", runtimeSessionId: "runtime/session:123" })
  assert.deepEqual(paths, {
    debug: "/tmp/harvester-logs/harvester-2026-11-09_12-34-56-runtime-session-123.log",
    trace: "/tmp/harvester-logs/harvester-trace-2026-11-09_12-34-56-runtime-session-123.log",
    terminal: "/tmp/harvester-logs/terminal-2026-11-09_12-34-56-runtime-session-123.log",
  }, "all diagnostic session files must share one sanitized run identity")
})

test("rejects incomplete session identity rather than generating ambiguous filenames", () => {
  assert.throws(() => createHarvesterLogSessionPaths({ directory: "/tmp/logs", startedAt: "invalid", runtimeSessionId: "id" }), /timestamp/)
  assert.throws(() => createHarvesterLogSessionPaths({ directory: "/tmp/logs", startedAt: "2026-11-09T12:34:56.000Z", runtimeSessionId: "" }), /session ID/)
})
