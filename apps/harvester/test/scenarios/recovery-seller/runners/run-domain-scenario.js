import { executeRecoverySellerScenarioSteps } from "./execute-scenario-steps.js"

/**
 * Run a DOMAIN scenario through real domain operations supplied as handlers.
 * This boundary rejects APPLICATION scenarios so a domain test cannot claim
 * application orchestration evidence.
 *
 * @param {object} input Scenario and registered operation handlers.
 * @param {object} input.scenario Registered scenario record.
 * @param {object} input.handlers Explicit domain operation handlers.
 * @returns {Promise<object>} Scenario identity and ordered execution results.
 */
export async function runRecoverySellerDomainScenario({ scenario, handlers } = {}) {
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
    throw new TypeError("Recovery Seller DOMAIN runner requires a scenario record")
  }
  if (scenario.layer !== "DOMAIN") {
    throw new Error("Recovery Seller DOMAIN runner cannot execute a non-DOMAIN scenario")
  }
  const execution = await executeRecoverySellerScenarioSteps({
    steps: scenario.when,
    handlers,
    initialContext: scenario.given,
  })

  return Object.freeze({
    scenarioId: scenario.id,
    layer: scenario.layer,
    results: execution.results,
    context: execution.context,
  })
}
