import {
  CONSERVATIVE_SCENARIO_CATEGORIES,
  CONSERVATIVE_SCENARIO_PRIORITIES,
  CONSERVATIVE_SCENARIO_STATUSES,
  validateConservativeScenarioRegistry,
} from "../conservative/registry/index.js"

export const SCENARIO_CATEGORIES = CONSERVATIVE_SCENARIO_CATEGORIES
export const SCENARIO_PRIORITIES = CONSERVATIVE_SCENARIO_PRIORITIES
export const COVERAGE_STATUSES = CONSERVATIVE_SCENARIO_STATUSES

export function validateScenarioDefinitions(options = {}) {
  return validateConservativeScenarioRegistry(options)
}

export function assertValidScenarioDefinitions(options = {}) {
  const result = validateScenarioDefinitions(options)
  if (!result.valid) {
    throw new TypeError(result.errors.join("\n"))
  }
  return result
}
