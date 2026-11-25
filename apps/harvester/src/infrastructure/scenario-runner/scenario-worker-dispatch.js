import { executeRecoverySellerRunnerScenario } from "./rs-scenario-adapter.js"

/** Strategy-specific bindings live only inside the isolated worker process. */
export async function runScenarioWorkerRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("Scenario worker request must be an object")
  }
  if (typeof request.strategyId !== "string" || typeof request.scenarioId !== "string") {
    throw new TypeError("Scenario worker request requires strategy and scenario identity")
  }
  if (request.strategyId === "RS") {
    return executeRecoverySellerRunnerScenario(request)
  }
  throw new Error(`No isolated worker adapter is registered for strategy "${request.strategyId}"`)
}
