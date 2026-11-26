import { createScenarioRunner } from "../../application/scenario-runner/create-scenario-runner.js"
import {
  isValidScenarioInputSchema,
  validateScenarioInput,
} from "../../application/scenario-runner/validate-scenario-input.js"
import { getRecoverySellerRunnerCatalog } from "../scenario-runner/rs-scenario-adapter.js"

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
  if (adapter.osSandboxVerified !== true) {
    return {
      executable: false,
      reason: "OS-level sandbox isolation has not been verified for the registered adapter.",
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

export function createScenarioRunnerHost({
  eventBus,
  adapters = [],
  scenarioCatalog = getRecoverySellerRunnerCatalog(),
  strategyRegistrations,
  sourceRevision = null,
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
  const runner = createScenarioRunner({
    adapters: registeredAdapters,
    sourceRevision,
    canExecuteScenario: ({ strategyId, scenarioId }) => catalog.some((strategy) =>
      strategy.strategyId === strategyId &&
      strategy.scenarios.some((scenario) =>
        scenario.id === scenarioId && scenario.executable === true)),
    validateScenarioInput: ({ strategyId, scenarioId, input }) => {
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
    },
    timeoutMs: 30_000,
    maxStoredRuns: 100,
    onUpdate: (run) => publishScenarioRunUpdate({
      eventBus,
      run,
    }),
  })
  return Object.freeze({
    runner,
    catalog,
  })
}
