import { executeRecoverySellerRunnerScenario } from "./rs-scenario-adapter.js"

// Strategy-specific bindings are registered only inside the isolated worker process.
export const SCENARIO_WORKER_ADAPTERS = Object.freeze([
  Object.freeze({
    strategyId: "RS",
    execute: executeRecoverySellerRunnerScenario,
  }),
])
