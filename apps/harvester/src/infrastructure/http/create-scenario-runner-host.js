import { createScenarioRunner } from "../../application/scenario-runner/create-scenario-runner.js"
import { createProcessScenarioAdapter } from "../scenario-runner/create-process-scenario-adapter.js"
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

export function createScenarioRunnerHost({ eventBus } = {}) {
  const runner = createScenarioRunner({
    adapters: [createProcessScenarioAdapter({ strategyId: "RS" })],
    timeoutMs: 30_000,
    maxStoredRuns: 100,
    onUpdate: (run) => publishScenarioRunUpdate({
      eventBus,
      run,
    }),
  })
  const catalog = [
    {
      strategyId: "RS",
      strategyName: "Recovery Seller",
      scenarios: getRecoverySellerRunnerCatalog().map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        layer: scenario.layer,
        status: scenario.status,
        inputSchema: scenario.inputSchema,
        defaultInput: scenario.input,
      })),

    },
  ]
  return Object.freeze({
    runner,
    catalog,
  })
}
