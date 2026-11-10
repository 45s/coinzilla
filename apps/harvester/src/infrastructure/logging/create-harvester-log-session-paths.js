import path from "node:path"

/**
 * Resolve the shared UTC/session-ID directory and short filenames for one process.
 * @param {{ directory: string, startedAt: string, runtimeSessionId: string }} input
 * @returns {{ sessionDirectory: string, debug: string, trace: string, terminal: string }}
 */
export function createHarvesterLogSessionPaths({ directory, startedAt, runtimeSessionId } = {}) {
  if (typeof directory !== "string" || directory.trim() === "") {
    throw new TypeError("Log session directory must be a non-empty string")
  }
  if (typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt))) {
    throw new TypeError("Log session start time must be a valid timestamp")
  }
  if (typeof runtimeSessionId !== "string" || runtimeSessionId.trim() === "") {
    throw new TypeError("Log session ID must be a non-empty string")
  }
  const timestamp = new Date(startedAt).toISOString()
    .slice(0, 19)
    .replace("T", "_")
    .replaceAll(":", "-")
  const sessionId = runtimeSessionId.replace(/[^a-zA-Z0-9_-]/g, "-")
  const sessionDirectory = path.join(directory, "sessions", timestamp + "-" + sessionId)
  return Object.freeze({
    sessionDirectory,
    debug: path.join(sessionDirectory, "harvester.log"),
    trace: path.join(sessionDirectory, "trace.log"),
    terminal: path.join(sessionDirectory, "terminal.log"),
  })
}
