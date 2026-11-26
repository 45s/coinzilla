import { executeRecoverySellerScenarioSteps } from "./execute-scenario-steps.js"

/**
 * Run an APPLICATION scenario through explicitly supplied application operations.
 * This boundary rejects DOMAIN scenarios so policy-only execution cannot claim
 * orchestration, persistence, or external-port evidence.
 *
 * @param {object} input Scenario and registered application operation handlers.
 * @param {object} input.scenario Registered scenario record.
 * @param {object} input.handlers Explicit application operation handlers.
 * @returns {Promise<object>} Scenario identity and ordered application results.
 */
export async function runRecoverySellerApplicationScenario({ scenario, handlers } = {}) {
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
    throw new TypeError("Recovery Seller APPLICATION runner requires a scenario record")
  }
  if (scenario.layer !== "APPLICATION") {
    throw new Error("Recovery Seller APPLICATION runner cannot execute a non-APPLICATION scenario")
  }
  const execution = await executeRecoverySellerScenarioSteps({
    steps: scenario.when,
    handlers,
    initialContext: scenario.given,
  })

  const report = Object.freeze({
    scenarioId: scenario.id,
    test: scenario.test ?? null,
    status: scenario.status ?? "UNREGISTERED",
    evidence: scenario.evidence ?? null,
    result: execution.results,
  })

  return Object.freeze({
    scenarioId: scenario.id,
    layer: scenario.layer,
    report,
    results: execution.results,
    context: execution.context,
  })
}
