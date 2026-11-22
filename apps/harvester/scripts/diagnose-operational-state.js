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

function createIdentitySummary({ metadata }) {
  return {
    application: metadata.application,
    version: metadata.version,
    commit: metadata.source.commit ?? "unknown",
    workingTree: metadata.source.workingTree ?? "unknown",
    metadataSource: metadata.source.metadataSource ?? "unavailable",
  }
}

function createIdentityLine({ identity, runtimeVersion }) {
  return [
    `command=${identity.application}`,
    `version=${identity.version}`,
    `commit=${identity.commit}`,
    `workingTree=${identity.workingTree}`,
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
  const sortedFactTypes = {}
  for (const factType of Object.keys(factTypes).sort()) {
    sortedFactTypes[factType] = factTypes[factType]
  }
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

function summarizeFailedProjection({ projection }) {
  return {
    status: "FAILED",
    errors: summarizeErrors(projection?.errors ?? [
      new Error("Recovery projection failed without an error detail"),
    ]),
  }
}

function summarizeCandidateProjection({ data }) {
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

function summarizeProjection({ projection }) {
  if (projection?.ok !== true) {
    return summarizeFailedProjection({ projection })
  }
  return summarizeCandidateProjection({
    data: projection.data ?? {},
  })
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

async function inspectOperationalState({ store, identity, project }) {
  let readResult
  try {
    readResult = await store.readAll()
  } catch (error) {
    return {
      report: createIntegrityFailureReport({
        error,
        identity,
      }),
      exitCode: 2,
    }
  }
  if (readResult?.ok !== true || !Array.isArray(readResult.data?.records)) {
    return {
      report: createIntegrityFailureReport({
        error: readResult?.errors?.[0] ?? new Error("Operational State Store readAll returned no verified records"),
        identity,
      }),
      exitCode: 2,
    }
  }

  const { records } = readResult.data
  const storeIntegrity = summarizeVerifiedRecords({
    records,
    lastCommittedSequence: readResult.data.lastCommittedSequence,
    lastCommittedDigest: readResult.data.lastCommittedDigest,
  })
  let projectionResult
  try {
    projectionResult = project({ records })
  } catch (error) {
    projectionResult = {
      ok: false,
      errors: [error],
    }
  }
  const projection = summarizeProjection({ projection: projectionResult })
  return {
    report: {
      identity,
      storeIntegrity,
      projection,
    },
    exitCode: getDiagnosticExitCode({
      storeIntegrity,
      projection,
    }),
  }
}

function createDiagnosticIdentity({ captureMetadata, cwd, env }) {
  const metadata = captureMetadata({
    application: APPLICATION,
    version: harvesterPackage.version,
    cwd,
    env,
  })
  const identity = createIdentitySummary({ metadata })
  return {
    identity,
    identityLine: createIdentityLine({
      identity,
      runtimeVersion: process.version,
    }),
  }
}

function createDiagnosticStore({ env, createStore }) {
  const directory = resolveOperationalStateDirectory({ env })
  return createStore({
    directory,
    runtimeSessionId: DIAGNOSTIC_SESSION_ID,
  })
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
  writeOutput = (value) => process.stdout.write(`${value}\\n`),
  writeError = (value) => process.stderr.write(`${value}\\n`),
} = {}) {
  let parsed
  try {
    parsed = parseDiagnosticArguments(args)
  } catch (error) {
    writeError(error.message)
    return 1
  }

  let identityContext
  try {
    identityContext = createDiagnosticIdentity({
      captureMetadata,
      cwd,
      env,
    })
  } catch (error) {
    writeError(`Unable to capture diagnostic source identity: ${error.message}`)
    return 1
  }
  const { identity, identityLine } = identityContext
  writeOutput(identityLine)
  if (parsed.version) {
    return 0
  }
  if (parsed.help) {
    writeOutput(HELP)
    return 0
  }

  let store
  try {
    store = createDiagnosticStore({
      env,
      createStore,
    })
  } catch (error) {
    writeError(`Unable to open the configured Operational State Store: ${error.message}`)
    return 1
  }

  const diagnostic = await inspectOperationalState({
    store,
    identity,
    project,
  })
  writeOutput(JSON.stringify(diagnostic.report, null, 2))
  return diagnostic.exitCode
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isDirectExecution) {
  process.exitCode = await runOperationalStateDiagnostic()
}
