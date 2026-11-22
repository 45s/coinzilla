import { pathToFileURL } from "node:url"
import { captureBuildMetadata } from "@coinzilla/utils"
import harvesterPackage from "../package.json" with { type: "json" }
import { createFileOperationalStateStore } from "../src/infrastructure/operational-state/create-file-store.js"
import { resolveOperationalStateDirectory } from "../src/infrastructure/operational-state/resolve-directory.js"
import { projectHarvesterOperationalState } from "../src/infrastructure/operational-state/project-harvester.js"

const APPLICATION = "harvester-operational-state-diagnostic"
const DIAGNOSTIC_SESSION_ID = "read-only-operational-state-diagnostic"
const HELP = `Usage:
  pnpm --filter @coinzilla/harvester operational-state:diagnose
  pnpm --filter @coinzilla/harvester operational-state:diagnose -- --version
  pnpm --filter @coinzilla/harvester operational-state:diagnose -- --help

Inspect the existing Operational State Store without changing it.

The command verifies facts.jsonl and manifest.jsonl through the production store
reader, then runs the offline Harvester recovery projector. It never initializes,
appends, repairs, truncates, or deletes records; connects to Binance; reads
exchange credentials; starts Harvester; or submits/cancels orders.

Exit codes:
  0  Store integrity verified and candidate projection succeeded
  1  CLI/configuration error
  2  Store integrity verification failed
  3  Store integrity verified but candidate projection failed
`

function parseDiagnosticArguments(args) {
  const parsed = {
    help: false,
    version: false,
  }
  for (const argument of args) {
    if (argument === "--help" && !parsed.help) {
      parsed.help = true
      continue
    }
    if (argument === "--version" && !parsed.version) {
      parsed.version = true
      continue
    }
    throw new Error(`Unknown or repeated diagnostic argument: ${argument}`)
  }
  if (parsed.help && parsed.version) {
    throw new Error("--help and --version cannot be used together")
  }
  return parsed
}

function createIdentityLine({ metadata, runtimeVersion }) {
  const commit = metadata.source.commit ?? "unknown"
  const workingTree = metadata.source.workingTree ?? "unknown"
  return [
    `command=${metadata.application}`,
    `version=${metadata.version}`,
    `commit=${commit}`,
    `workingTree=${workingTree}`,
    `runtime=${runtimeVersion}`,
  ].join(" ")
}

function summarizeErrors(errors = []) {
  return errors.map((error) => ({
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: error?.message ?? String(error),
  }))
}

function summarizeVerifiedRecords({ records, lastCommittedSequence, lastCommittedDigest }) {
  const factTypes = {}
  for (const record of records) {
    factTypes[record.factType] = (factTypes[record.factType] ?? 0) + 1
  }
  const sortedFactTypes = Object.fromEntries(
    Object.entries(factTypes).sort(([left], [right]) => left.localeCompare(right)),
  )
  return {
    status: "VERIFIED",
    recordCount: records.length,
    firstSequence: records[0]?.sequence ?? null,
    lastSequence: records.at(-1)?.sequence ?? null,
    lastCommittedSequence: lastCommittedSequence ?? null,
    lastCommittedDigest: lastCommittedDigest ?? null,
    factTypes: sortedFactTypes,
  }
}

function summarizeProjection({ projection }) {
  if (projection?.ok !== true) {
    return {
      status: "FAILED",
      errors: summarizeErrors(projection?.errors ?? [new Error("Recovery projection failed without an error detail")]),
    }
  }
  const data = projection.data ?? {}
  if (data.candidateOnly !== true || data.restorationEnabled !== false) {
    return {
      status: "FAILED",
      errors: [{
        name: "ProjectionContractError",
        code: "HARVESTER_DIAGNOSTIC_UNSAFE_PROJECTION",
        message: "Recovery projection did not preserve the candidate-only, restoration-disabled contract",
      }],
    }
  }
  return {
    status: "CANDIDATE_ONLY",
    restorationEnabled: false,
    requiresExchangeReconciliation: data.requiresExchangeReconciliation === true,
    historyCoverageComplete: data.historyCoverageComplete === true,
    sessionsCount: data.sessions?.length ?? 0,
    ordersCount: data.orders?.length ?? 0,
    recoveryCyclesCount: data.recoveryCycles?.length ?? 0,
    recoveryCycleEvaluationsCount: data.recoveryCycleEvaluations?.length ?? 0,
    pausedMarketsCount: data.pausedMarkets?.length ?? 0,
    stickySafetyBlockersCount: data.stickySafetyBlockers?.length ?? 0,
  }
}

function getDiagnosticExitCode({ storeIntegrity, projection }) {
  if (storeIntegrity.status !== "VERIFIED") {
    return 2
  }
  if (projection.status !== "CANDIDATE_ONLY") {
    return 3
  }
  return 0
}

function createIntegrityFailureReport({ error, identity }) {
  return {
    identity,
    storeIntegrity: {
      status: "FAILED",
      errors: summarizeErrors([error]),
    },
    projection: {
      status: "SKIPPED",
      reason: "Store integrity verification did not succeed",
    },
  }
}

/**
 * Run a read-only integrity and recovery-projection diagnostic.
 *
 * @param {object} options
 * @param {string[]} [options.args=process.argv.slice(2)]
 * @param {Record<string, string|undefined>} [options.env=process.env]
 * @param {string} [options.cwd=process.cwd()]
 * @param {(options: object) => object} [options.captureMetadata]
 * @param {(options: object) => object} [options.createStore]
 * @param {(options: object) => object} [options.project]
 * @param {(value: string) => void} [options.writeOutput]
 * @param {(value: string) => void} [options.writeError]
 * @returns {Promise<number>} Diagnostic process exit code.
 */
export async function runOperationalStateDiagnostic({
  args = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  captureMetadata = captureBuildMetadata,
  createStore = createFileOperationalStateStore,
  project = projectHarvesterOperationalState,
  writeOutput = (value) => process.stdout.write(`${value}\n`),
  writeError = (value) => process.stderr.write(`${value}\n`),
} = {}) {
  let parsed
  try {
    parsed = parseDiagnosticArguments(args)
  } catch (error) {
    writeError(error.message)
    return 1
  }

  let metadata
  try {
    metadata = captureMetadata({
      application: APPLICATION,
      version: harvesterPackage.version,
      cwd,
      env,
    })
  } catch (error) {
    writeError(`Unable to capture diagnostic source identity: ${error.message}`)
    return 1
  }
  const identityLine = createIdentityLine({
    metadata,
    runtimeVersion: process.version,
  })
  if (parsed.version) {
    writeOutput(identityLine)
    return 0
  }
  writeOutput(identityLine)
  if (parsed.help) {
    writeOutput(HELP)
    return 0
  }

  let store
  try {
    const directory = resolveOperationalStateDirectory({ env })
    store = createStore({
      directory,
      runtimeSessionId: DIAGNOSTIC_SESSION_ID,
    })
  } catch (error) {
    writeError(`Unable to open the configured Operational State Store: ${error.message}`)
    return 1
  }

  let readResult
  try {
    readResult = await store.readAll()
  } catch (error) {
    const report = createIntegrityFailureReport({
      error,
      identity: metadata,
    })
    writeOutput(JSON.stringify(report, null, 2))
    return 2
  }
  if (readResult?.ok !== true || !Array.isArray(readResult.data?.records)) {
    const report = createIntegrityFailureReport({
      error: readResult?.errors?.[0] ?? new Error("Operational State Store readAll returned no verified records"),
      identity: metadata,
    })
    writeOutput(JSON.stringify(report, null, 2))
    return 2
  }

  const records = readResult.data.records
  const storeIntegrity = summarizeVerifiedRecords({
    records,
    lastCommittedSequence: readResult.data.lastCommittedSequence,
    lastCommittedDigest: readResult.data.lastCommittedDigest,
  })
  const projection = summarizeProjection({
    projection: project({ records }),
  })
  const report = {
    identity: metadata,
    storeIntegrity,
    projection,
  }
  writeOutput(JSON.stringify(report, null, 2))
  return getDiagnosticExitCode({
    storeIntegrity,
    projection,
  })
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isDirectExecution) {
  process.exitCode = await runOperationalStateDiagnostic()
}
