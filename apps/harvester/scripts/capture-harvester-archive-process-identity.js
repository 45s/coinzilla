import { writeFile } from "node:fs/promises"

const COMMIT_PATTERN = /^[a-f0-9]{40,64}$/i
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SOURCE_FIELDS = Object.freeze([
  "branch",
  "commit",
  "shortCommit",
  "commitMessage",
  "commitDate",
  "workingTree",
  "metadataSource",
])
const UNAVAILABLE_SOURCE = Object.freeze({
  branch: null,
  commit: null,
  shortCommit: null,
  commitMessage: null,
  commitDate: null,
  workingTree: "unknown",
  metadataSource: "unavailable",
})

function requireStartedAt(value) {
  if (typeof value !== "string") {
    throw new TypeError("startedAt must be a canonical UTC timestamp")
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new TypeError("startedAt must be a canonical UTC timestamp")
  }
  return value
}

function requireRuntimeSessionId(value) {
  if (typeof value !== "string" || !SESSION_ID_PATTERN.test(value)) {
    throw new TypeError("runtimeSessionId must be a UUID")
  }
  return value
}

function normalizeSource(value) {
  if (value === undefined || value === null) {
    return UNAVAILABLE_SOURCE
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("source must be an allowlisted build metadata object")
  }

  const keys = Object.keys(value).sort()
  if (
    keys.length !== SOURCE_FIELDS.length
    || !SOURCE_FIELDS.every((field) => keys.includes(field))
  ) {
    throw new TypeError("source must contain only the allowlisted build metadata fields")
  }

  const {
    branch,
    commit,
    shortCommit,
    commitMessage,
    commitDate,
    workingTree,
    metadataSource,
  } = value

  for (const [field, fieldValue] of [
    ["branch", branch],
    ["commitMessage", commitMessage],
    ["commitDate", commitDate],
  ]) {
    if (fieldValue !== null && typeof fieldValue !== "string") {
      throw new TypeError(`source.${field} must be a string or null`)
    }
  }

  if (commit !== null && (typeof commit !== "string" || !COMMIT_PATTERN.test(commit))) {
    throw new TypeError("source.commit must be a full Git commit SHA or null")
  }
  if (shortCommit !== null && typeof shortCommit !== "string") {
    throw new TypeError("source.shortCommit must be a string or null")
  }
  if (commit && shortCommit !== commit.slice(0, 8)) {
    throw new TypeError("source.shortCommit must match source.commit")
  }
  if (!commit && shortCommit !== null) {
    throw new TypeError("source.shortCommit must be null when source.commit is unavailable")
  }
  if (!["clean", "dirty", "unknown"].includes(workingTree)) {
    throw new TypeError("source.workingTree must be clean, dirty or unknown")
  }
  if (!["git", "environment", "unavailable"].includes(metadataSource)) {
    throw new TypeError("source.metadataSource is invalid")
  }
  if (metadataSource === "unavailable" && (commit !== null || workingTree !== "unknown")) {
    throw new TypeError("unavailable source metadata must not claim a commit or worktree state")
  }

  return Object.freeze({
    branch,
    commit: commit?.toLowerCase() ?? null,
    shortCommit: shortCommit?.toLowerCase() ?? null,
    commitMessage,
    commitDate,
    workingTree,
    metadataSource,
  })
}

/**
 * Create the immutable, allowlisted identity captured for one DEV launcher
 * process. Missing startup Git metadata remains explicitly unavailable.
 *
 * @param {object} input
 * @param {string} input.startedAt Canonical process-start UTC timestamp.
 * @param {string} input.runtimeSessionId UUID assigned by the launcher.
 * @param {string|null} [input.tradingMode]
 * @param {object|null} [input.source] Allowlisted captureBuildMetadata source.
 * @returns {object}
 */
export function createHarvesterArchiveProcessIdentity({
  startedAt,
  runtimeSessionId,
  tradingMode = null,
  source,
} = {}) {
  const normalizedStartedAt = requireStartedAt(startedAt)
  const normalizedRuntimeSessionId = requireRuntimeSessionId(runtimeSessionId)
  if (tradingMode !== null && typeof tradingMode !== "string") {
    throw new TypeError("tradingMode must be a string or null")
  }

  return Object.freeze({
    formatVersion: 1,
    application: "harvester",
    environment: tradingMode,
    startedAt: normalizedStartedAt,
    runtimeSessionId: normalizedRuntimeSessionId,
    source: normalizeSource(source),
  })
}

/**
 * Persist one session identity with exclusive creation. A pre-existing record
 * is never replaced, even when a launcher is retried.
 *
 * @param {{ filename: string, identity: object }} input
 * @returns {Promise<void>}
 */
export async function persistHarvesterArchiveProcessIdentity({ filename, identity } = {}) {
  if (typeof filename !== "string" || filename.trim() === "") {
    throw new TypeError("filename must be a non-empty path")
  }
  if (!identity || identity.application !== "harvester" || identity.formatVersion !== 1) {
    throw new TypeError("identity must be a Harvester archive process identity")
  }

  await writeFile(filename, `${JSON.stringify(identity, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  })
}
