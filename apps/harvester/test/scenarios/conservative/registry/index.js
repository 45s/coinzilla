import { scenarios as accountingScenarios } from "../accounting/index.js"
import { scenarios as balanceScenarios } from "../balances/index.js"
import { scenarios as buyScenarios } from "../buy/index.js"
import { scenarios as configurationScenarios } from "../configuration/index.js"
import { scenarios as decisionScenarios } from "../decisions/index.js"
import { scenarios as errorScenarios } from "../errors/index.js"
import { scenarios as eventScenarios } from "../events/index.js"
import { scenarios as feeScenarios } from "../fees/index.js"
import { scenarios as filterScenarios } from "../filters/index.js"
import { scenarios as marketScenarios } from "../market/index.js"
import { scenarios as partialFillScenarios } from "../partial-fills/index.js"
import { scenarios as persistenceScenarios } from "../persistence/index.js"
import { scenarios as recoveryScenarios } from "../recovery/index.js"
import { scenarios as runtimeScenarios } from "../runtime/index.js"
import { scenarios as safetyScenarios } from "../safety/index.js"
import { scenarios as sellScenarios } from "../sell/index.js"
import {
  CONSERVATIVE_SCENARIO_CATEGORIES,
  CONSERVATIVE_SCENARIO_PRIORITIES,
  CONSERVATIVE_SCENARIO_STATUSES,
} from "./catalogs.js"

export {
  CONSERVATIVE_SCENARIO_CATEGORIES,
  CONSERVATIVE_SCENARIO_PRIORITIES,
  CONSERVATIVE_SCENARIO_STATUSES,
}
export { defineConservativeScenario } from "./define-scenario.js"
export { validateConservativeScenarioRegistry } from "./validate-registry.js"

export const conservativeScenarioRegistry = Object.freeze([
  ...decisionScenarios,
  ...buyScenarios,
  ...sellScenarios,
  ...recoveryScenarios,
  ...partialFillScenarios,
  ...accountingScenarios,
  ...feeScenarios,
  ...balanceScenarios,
  ...filterScenarios,
  ...marketScenarios,
  ...errorScenarios,
  ...eventScenarios,
  ...persistenceScenarios,
  ...configurationScenarios,
  ...safetyScenarios,
  ...runtimeScenarios,
])
