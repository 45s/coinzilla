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

function createCatalog({ adapters, scenarioCatalog }) {
  if (!Array.isArray(scenarioCatalog)) {
    throw new TypeError("Scenario Runner host requires a strategy scenario catalog")
  }
  const registeredStrategyIds = new Set(adapters.map((adapter) => adapter?.strategyId))
  return Object.freeze([
    {
      strategyId: "RS",
      strategyName: "Recovery Seller",
      scenarios: Object.freeze(scenarioCatalog.map((scenario) => {
        const adapterRegistered = registeredStrategyIds.has("RS")
        const schemaValid = isValidScenarioInputSchema({
          schema: scenario.inputSchema,
        })
        const executable = scenario.executable === true &&
          scenario.executionStatus === "EXECUTABLE" &&
          schemaValid &&
          adapterRegistered
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
          inputSchema: scenario.inputSchema,
          defaultInput: scenario.input,
          readinessReasons: Object.freeze([...(scenario.readinessReasons ?? [])]),
        })
      })),
    },
  ])
}

export function createScenarioRunnerHost({
  eventBus,
  adapters = [],
  scenarioCatalog = getRecoverySellerRunnerCatalog(),
} = {}) {
  if (!Array.isArray(adapters)) {
    throw new TypeError("Scenario Runner host adapters must be an array")
  }
  const catalog = createCatalog({
    adapters,
    scenarioCatalog,
  })
  const runner = createScenarioRunner({
    adapters,
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
