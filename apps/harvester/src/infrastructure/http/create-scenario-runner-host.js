import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createScenarioRunner } from "../../application/scenario-runner/create-scenario-runner.js"
import {
  isValidScenarioInputSchema,
  validateScenarioInput,
} from "../../application/scenario-runner/validate-scenario-input.js"
import { getRecoverySellerRunnerCatalog } from "../scenario-runner/rs-scenario-adapter.js"

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../..", import.meta.url))

function readGitValue({ args }) {
  return execFileSync("git", args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim()
}

function resolveRepositoryIdentity({ sourceRevision }) {
  const missing = []
  const identity = {}
  let repositoryHead
  try {
    repositoryHead = readGitValue({
      args: ["rev-parse", "HEAD"],
    })
    identity.sourceTreeSha = readGitValue({
      args: ["rev-parse", "HEAD^{tree}"],
    })
    const status = readGitValue({
      args: ["status", "--porcelain"],
    })
    if (status) {
      missing.push("source checkout is not clean")
    }
  } catch {
    missing.push("immutable Git commit/tree and clean-checkout provenance are unavailable")
  }
  const expectedRevision = sourceRevision ?? process.env.COINZILLA_SOURCE_REVISION ?? repositoryHead
  const validRevision = typeof expectedRevision === "string" &&
    /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(expectedRevision)
  if (!validRevision) {
    missing.push("full immutable source commit SHA is unavailable")
  } else if (repositoryHead && expectedRevision.toLowerCase() !== repositoryHead.toLowerCase()) {
    missing.push("supplied source revision does not match the checked-out commit")
  }
  identity.sourceCommitSha = expectedRevision ?? null
  identity.checkedOutCommitSha = repositoryHead ?? null
  return {
    identity,
    missing,
  }
}

function readDependencyLockSha({ missing }) {
  try {
    return createHash("sha256")
      .update(readFileSync(resolve(REPOSITORY_ROOT, "pnpm-lock.yaml")))
      .digest("hex")
  } catch {
    missing.push("dependency lockfile provenance is unavailable")
    return null
  }
}

function resolveBuildArtifactSha({ buildProvenanceVerifier, buildProvenance }) {
  try {
    const artifactSha256 = buildProvenance?.artifactSha256
    const verified = typeof buildProvenanceVerifier === "function" &&
      buildProvenanceVerifier(buildProvenance) === true &&
      typeof artifactSha256 === "string" &&
      /^[a-f0-9]{64}$/i.test(artifactSha256)
    return verified ? artifactSha256.toLowerCase() : null
  } catch {
    return null
  }
}

function createScenarioReplayProvenance({
  sourceRevision,
  strategyRegistrations,
  buildProvenanceVerifier,
  buildProvenance,
}) {
  const { identity, missing } = resolveRepositoryIdentity({
    sourceRevision,
  })
  identity.dependencyLockSha256 = readDependencyLockSha({
    missing,
  })
  identity.runtimeIdentity = `${process.version}|${process.platform}|${process.arch}`
  identity.scenarioRegistrySha256 = createHash("sha256")
    .update(JSON.stringify(strategyRegistrations))
    .digest("hex")
  const buildArtifactSha256 = resolveBuildArtifactSha({
    buildProvenanceVerifier,
    buildProvenance,
  })
  if (buildArtifactSha256) {
    identity.buildArtifactSha256 = buildArtifactSha256
  } else {
    missing.push("verified build artifact provenance is unavailable")
  }
  return {
    verified: missing.length === 0,
    missing,
    identity,
  }
}

function publishScenarioRunUpdate({ eventBus, run }) {
  try {
    eventBus.publish({
      name: "scenario-run.updated",
      source: "scenario-runner",
      data: {
        runId: run.runId,
        strategyId: run.strategyId,
        scenarioId: run.scenarioId,
        status: run.status,
        updatedAt: run.updatedAt,
      },
    })
  } catch {
    // REST remains authoritative; notifications are best-effort.
  }
}


function resolveExecutionStatus({ executable, sourceStatus }) {
  if (executable) {
    return "EXECUTABLE"
  }
  if (sourceStatus === "PRELIMINARY") {
    return "PRELIMINARY"
  }
  return "BLOCKED"
}

function resolveAdapterReadiness({ adapter }) {
  if (!adapter) {
    return {
      executable: false,
      reason: "No execution adapter is registered for this strategy.",
    }
  }
  if (adapter.executionMode !== "simulation-only") {
    return {
      executable: false,
      reason: "The registered adapter is not explicitly simulation-only.",
    }
  }
  if (adapter.osSandboxVerified !== true && adapter.simulationBoundaryVerified !== true) {
    return {
      executable: false,
      reason: "A verified OS sandbox or trusted guarded-simulation worker is required for the registered adapter.",
    }
  }
  return {
    executable: true,
    reason: null,
  }
}

function deepFreeze(value) {
  const visited = new WeakSet()
  function freeze(item) {
    if (!item || typeof item !== "object" || visited.has(item)) {
      return item
    }
    visited.add(item)
    Object.freeze(item)
    for (const child of Object.values(item)) {
      freeze(child)
    }
    return item
  }
  return freeze(value)
}

function cloneAndFreeze(value) {
  return deepFreeze(structuredClone(value))
}

function validateScenarioRegistration({ scenario, strategyId, scenarioIds }) {
  if (
    typeof scenario?.id !== "string" ||
    !scenario.id.trim() ||
    typeof scenario.name !== "string" ||
    !scenario.name.trim() ||
    (scenario.readinessReasons !== undefined && !Array.isArray(scenario.readinessReasons))
  ) {
    throw new TypeError(`Invalid Scenario Runner scenario registration for ${strategyId}`)
  }
  if (scenarioIds.has(scenario.id)) {
    throw new TypeError(`Duplicate Scenario Runner scenario registration: ${strategyId}/${scenario.id}`)
  }
  scenarioIds.add(scenario.id)
}

function validateStrategyRegistration({ registration, registeredIds }) {
  if (
    typeof registration?.strategyId !== "string" ||
    !registration.strategyId.trim() ||
    typeof registration.strategyName !== "string" ||
    !registration.strategyName.trim() ||
    !Array.isArray(registration.scenarios)
  ) {
    throw new TypeError("Each strategy registration requires an ID, name and scenario list")
  }
  if (registeredIds.has(registration.strategyId)) {
    throw new TypeError(`Duplicate Scenario Runner strategy registration: ${registration.strategyId}`)
  }
  registeredIds.add(registration.strategyId)
  const scenarioIds = new Set()
  for (const scenario of registration.scenarios) {
    validateScenarioRegistration({
      scenario,
      strategyId: registration.strategyId,
      scenarioIds,
    })
  }
}

function validateStrategyRegistrations({ strategyRegistrations }) {
  if (!Array.isArray(strategyRegistrations)) {
    throw new TypeError("Scenario Runner host requires strategy registrations")
  }
  const registeredIds = new Set()
  for (const registration of strategyRegistrations) {
    validateStrategyRegistration({
      registration,
      registeredIds,
    })
  }
}

function createStrategyCatalogEntry({ registration, adapters }) {
  const matchingAdapters = adapters.filter((adapter) => adapter?.strategyId === registration.strategyId)
  if (matchingAdapters.length > 1) {
    throw new TypeError(`Multiple Scenario Runner adapters registered for strategy: ${registration.strategyId}`)
  }
  const adapterReadiness = resolveAdapterReadiness({
    adapter: matchingAdapters[0],
  })
  return Object.freeze({
    strategyId: registration.strategyId,
    strategyName: registration.strategyName,
    scenarios: Object.freeze(registration.scenarios.map((scenario) => {
      const inputSchema = cloneAndFreeze(scenario.inputSchema)
      const defaultInput = scenario.input === undefined ? undefined : cloneAndFreeze(scenario.input)
      const schemaValid = isValidScenarioInputSchema({
        schema: inputSchema,
      })
      const executable = scenario.executable === true &&
        scenario.executionStatus === "EXECUTABLE" &&
        schemaValid &&
        adapterReadiness.executable
      const readinessReasons = [...(scenario.readinessReasons ?? [])]
      if (adapterReadiness.reason) {
        readinessReasons.push(adapterReadiness.reason)
      }
      if (!schemaValid) {
        readinessReasons.push("Scenario input schema is invalid.")
      }
      return Object.freeze({
        id: scenario.id,
        name: scenario.name,
        layer: scenario.layer,
        status: scenario.status,
        executionStatus: resolveExecutionStatus({
          executable,
          sourceStatus: scenario.executionStatus,
        }),
        executable,
        inputSchema,
        defaultInput,
        readinessReasons: Object.freeze(readinessReasons),
      })
    })),
  })
}

function createCatalog({ adapters, strategyRegistrations }) {
  validateStrategyRegistrations({
    strategyRegistrations,
  })
  return Object.freeze(strategyRegistrations.map((registration) =>
    createStrategyCatalogEntry({
      registration,
      adapters,
    })))
}

function resolveStrategyRegistrations({ strategyRegistrations, scenarioCatalog }) {
  if (strategyRegistrations !== undefined) {
    return strategyRegistrations
  }
  if (!Array.isArray(scenarioCatalog)) {
    throw new TypeError("Scenario Runner host requires a strategy scenario catalog")
  }
  return [{
    strategyId: "RS",
    strategyName: "Recovery Seller",
    scenarios: scenarioCatalog,
  }]
}

function canExecuteCatalogScenario({
        catalog,
        strategyId,
        scenarioId,
      }) {
  return catalog.some((strategy) => strategy.strategyId === strategyId &&
    strategy.scenarios.some((scenario) =>
      scenario.id === scenarioId && scenario.executable === true))
}

function validateCatalogScenarioInput({
        catalog,
        strategyId,
        scenarioId,
        input,
      }) {
  const strategy = catalog.find((item) => item.strategyId === strategyId)
  const scenario = strategy?.scenarios.find((item) => item.id === scenarioId)
  if (!scenario?.inputSchema) {
    return {
      valid: false,
      errors: ["Scenario input schema is unavailable."],
    }
  }
  return validateScenarioInput({
    schema: scenario.inputSchema,
    input,
  })
}

function createRunner({ adapters, catalog, replayProvenance, eventBus }) {
  return createScenarioRunner({
    adapters,
    sourceRevision: replayProvenance.identity.sourceCommitSha,
    replayProvenance,
    canExecuteScenario: ({ strategyId, scenarioId }) =>
      canExecuteCatalogScenario({
        catalog,
        strategyId,
        scenarioId,
      }),
    validateScenarioInput: ({ strategyId, scenarioId, input }) =>
      validateCatalogScenarioInput({
        catalog,
        strategyId,
        scenarioId,
        input,
      }),
    timeoutMs: 30_000,
    maxStoredRuns: 100,
    onUpdate: (run) => publishScenarioRunUpdate({
      eventBus,
      run,
    }),
  })
}

export function createScenarioRunnerHost({
  eventBus,
  adapters = [],
  scenarioCatalog = getRecoverySellerRunnerCatalog(),
  strategyRegistrations,
  sourceRevision = null,
  buildProvenance,
  buildProvenanceVerifier,
} = {}) {
  if (!Array.isArray(adapters)) {
    throw new TypeError("Scenario Runner host adapters must be an array")
  }
  const registeredAdapters = Object.freeze(adapters.map((adapter) =>
    Object.freeze({ ...adapter })))
  const resolvedRegistrations = resolveStrategyRegistrations({
    strategyRegistrations,
    scenarioCatalog,
  })
  const catalog = createCatalog({
    adapters: registeredAdapters,
    strategyRegistrations: resolvedRegistrations,
  })
  const replayProvenance = createScenarioReplayProvenance({
    sourceRevision,
    strategyRegistrations: resolvedRegistrations,
    buildProvenance,
    buildProvenanceVerifier,
  })
  const runner = createRunner({
    adapters: registeredAdapters,
    catalog,
    replayProvenance,
    eventBus,
  })
  return Object.freeze({
    runner,
    catalog,
  })
}
