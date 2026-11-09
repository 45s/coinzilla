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

/**
 * Capture the immutable identity for one Harvester OS process.
 *
 * The process-entry timestamp and runtime-session ID are captured before the
 * synchronous, one-time Git inspection. Git inspection failure is diagnostic
 * only and produces explicit unavailable provenance.
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

  const startedAtDate = env.HARVESTER_PROCESS_STARTED_AT === undefined ? now() : new Date(env.HARVESTER_PROCESS_STARTED_AT)
  if (!(startedAtDate instanceof Date) || Number.isNaN(startedAtDate.getTime())) {
    throw new TypeError("Process-entry timestamp must be a valid Date")
  }

  const runtimeSessionId = env.HARVESTER_RUNTIME_SESSION_ID ?? generateRuntimeSessionId()
  if (typeof runtimeSessionId !== "string" || runtimeSessionId.trim() === "") {
    throw new TypeError("Runtime session ID must be a non-empty string")
  }

  let buildMetadata
  try {
    buildMetadata = captureBuildMetadata({
      application: APPLICATION,
      version: packageMetadata.version,
      cwd,
      env,
    })
  } catch {
    buildMetadata = null
  }

  const source = buildMetadata?.source ?? UNAVAILABLE_SOURCE
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
