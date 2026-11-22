import {
  captureBuildMetadata as captureBuildMetadataDefault,
  generateUUID,
} from "@coinzilla/utils"
import packageMetadata from "../../../package.json" with { type: "json" }

const APPLICATION = "harvester"
const UNAVAILABLE_SOURCE = Object.freeze({
  branch: null,
  commit: null,
  shortCommit: null,
  commitMessage: null,
  commitDate: null,
  workingTree: "unknown",
  metadataSource: "unavailable",
})

function resolveStartedAt({ env, now }) {
  const startedAtDate = env.COINZILLA_PROCESS_STARTED_AT === undefined
    ? now()
    : new Date(env.COINZILLA_PROCESS_STARTED_AT)
  if (!(startedAtDate instanceof Date) || Number.isNaN(startedAtDate.getTime())) {
    throw new TypeError("Process-entry timestamp must be a valid Date")
  }
  return startedAtDate
}

function resolveRuntimeSessionId({ env, generateRuntimeSessionId }) {
  const runtimeSessionId = env.COINZILLA_RUNTIME_SESSION_ID ?? generateRuntimeSessionId()
  if (typeof runtimeSessionId !== "string" || runtimeSessionId.trim() === "") {
    throw new TypeError("Runtime session ID must be a non-empty string")
  }
  return runtimeSessionId
}

function normalizeSourceSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return UNAVAILABLE_SOURCE
  }

  const fields = [
    "branch",
    "commit",
    "shortCommit",
    "commitMessage",
    "commitDate",
    "workingTree",
    "metadataSource",
  ]
  const keys = Object.keys(value).sort()
  if (keys.length !== fields.length || !fields.every((field) => keys.includes(field))) {
    return UNAVAILABLE_SOURCE
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
  const nullableStrings = [branch, commitMessage, commitDate]
  if (nullableStrings.some((item) => item !== null && typeof item !== "string")) {
    return UNAVAILABLE_SOURCE
  }
  if (
    commit !== null
    && (typeof commit !== "string" || !/^[a-f0-9]{40,64}$/i.test(commit))
  ) {
    return UNAVAILABLE_SOURCE
  }
  if (
    shortCommit !== (commit ? commit.slice(0, 8) : null)
    || !["clean", "dirty", "unknown"].includes(workingTree)
    || !["git", "environment", "unavailable"].includes(metadataSource)
  ) {
    return UNAVAILABLE_SOURCE
  }
  if (metadataSource === "unavailable" && (commit !== null || workingTree !== "unknown")) {
    return UNAVAILABLE_SOURCE
  }

  return {
    branch,
    commit: commit?.toLowerCase() ?? null,
    shortCommit: shortCommit?.toLowerCase() ?? null,
    commitMessage,
    commitDate,
    workingTree,
    metadataSource,
  }
}

function captureSource({ captureBuildMetadata, cwd, env }) {
  if (env.COINZILLA_PROCESS_SOURCE_METADATA !== undefined) {
    try {
      return normalizeSourceSnapshot(JSON.parse(env.COINZILLA_PROCESS_SOURCE_METADATA))
    } catch {
      return UNAVAILABLE_SOURCE
    }
  }

  try {
    const metadata = captureBuildMetadata({
      application: APPLICATION,
      version: packageMetadata.version,
      cwd,
      env,
    })
    return metadata?.source ?? UNAVAILABLE_SOURCE
  } catch {
    return UNAVAILABLE_SOURCE
  }
}

/**
 * Capture the immutable identity for one Harvester OS process.
 *
 * The development runner supplies its original timestamp, runtime-session
 * ID and one-time Git provenance snapshot through internal child environment
 * values so terminal, structured and Journal evidence share one process
 * identity. Invalid supplied provenance stays explicitly unavailable instead
 * of triggering a later Git lookup.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string} [options.cwd]
 * @param {number} [options.processId]
 * @param {() => Date} [options.now]
 * @param {() => string} [options.generateRuntimeSessionId]
 * @param {(input: { application: string, version: string, cwd: string, env: NodeJS.ProcessEnv }) => object} [options.captureBuildMetadata]
 * @returns {{ application: string, version: string, runtimeSessionId: string, processId: number, startedAt: string, source: object }}
 */
export function createHarvesterProcessIdentity({
  env = process.env,
  cwd = process.cwd(),
  processId = process.pid,
  now = () => new Date(),
  generateRuntimeSessionId = generateUUID,
  captureBuildMetadata = captureBuildMetadataDefault,
} = {}) {
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    throw new TypeError("processId must be a positive safe integer")
  }

  const startedAtDate = resolveStartedAt({ env,
now })
  const runtimeSessionId = resolveRuntimeSessionId({ env,
generateRuntimeSessionId })
  const source = captureSource({ captureBuildMetadata,
cwd,
env })

  return Object.freeze({
    application: APPLICATION,
    version: packageMetadata.version,
    runtimeSessionId,
    processId,
    startedAt: startedAtDate.toISOString(),
    source: Object.freeze({
      branch: source.branch ?? null,
      commit: source.commit ?? null,
      shortCommit: source.shortCommit ?? null,
      commitMessage: source.commitMessage ?? null,
      commitDate: source.commitDate ?? null,
      workingTree: source.workingTree ?? "unknown",
      metadataSource: source.metadataSource ?? "unavailable",
    }),
  })
}
