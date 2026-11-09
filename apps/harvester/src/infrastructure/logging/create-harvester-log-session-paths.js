import path from "node:path"

/**
 * Build per-process log filenames correlated with Journal process provenance.
 * @param {{ directory: string, startedAt: string, runtimeSessionId: string }} input
 * @returns {{ debug: string, trace: string, terminal: string }}
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
  const suffix = timestamp + "-" + sessionId
  return Object.freeze({
    debug: path.join(directory, "harvester-" + suffix + ".log"),
    trace: path.join(directory, "harvester-trace-" + suffix + ".log"),
    terminal: path.join(directory, "terminal-" + suffix + ".log"),
  })
}
