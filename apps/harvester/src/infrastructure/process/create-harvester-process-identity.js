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

function captureSource({ captureBuildMetadata, cwd, env }) {
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
 * The process-entry timestamp and runtime-session ID are captured before the
 * synchronous, one-time Git inspection. Git inspection failure is diagnostic
 * only and produces explicit unavailable provenance. The development runner
 * may supply the original timestamp and session ID through its internal child
 * environment so terminal and structured files share one session identity.
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
