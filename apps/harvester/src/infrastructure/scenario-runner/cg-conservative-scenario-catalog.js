import { CG_CONSERVATIVE_SCENARIO_DETAILS_PART_ONE } from "./cg-conservative-scenario-catalog.part-one.js"
import { CG_CONSERVATIVE_SCENARIO_DETAILS_PART_TWO } from "./cg-conservative-scenario-catalog.part-two.js"
import { CG_CONSERVATIVE_SCENARIO_DETAILS_PART_THREE } from "./cg-conservative-scenario-catalog.part-three.js"
import { CG_CONSERVATIVE_SCENARIO_DETAILS_PART_FOUR } from "./cg-conservative-scenario-catalog.part-four.js"

const EXECUTION_BLOCK_REASON = "The Conservative domain inventory is inspection-only. No isolated CG production-flow worker or executable input schema is registered."

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value)) {
    deepFreeze(child)
  }
  return Object.freeze(value)
}

const DEFAULT_CONSERVATIVE_SCENARIO_DETAILS = Object.freeze({
  tags: [],
  preconditions: [],
  initialState: {},
  inputEvents: [],
  expectedState: {},
  expectedOrders: [],
  expectedAccounting: {},
  expectedSideEffects: {},
  invariants: [],
  relatedRequirements: [],
  relatedCriticalBehaviors: [],
  relatedSourceFiles: [],
  relatedExistingTests: [],
})

const CG_CONSERVATIVE_SCENARIO_DETAILS = Object.freeze([
  ...CG_CONSERVATIVE_SCENARIO_DETAILS_PART_ONE,
  ...CG_CONSERVATIVE_SCENARIO_DETAILS_PART_TWO,
  ...CG_CONSERVATIVE_SCENARIO_DETAILS_PART_THREE,
  ...CG_CONSERVATIVE_SCENARIO_DETAILS_PART_FOUR,
].map((details) => deepFreeze({
  ...structuredClone(DEFAULT_CONSERVATIVE_SCENARIO_DETAILS),
  ...structuredClone(details),
})))

/**
 * Return the read-only Conservative scenario inventory for the Dashboard Scenario Runner.
 *
 * @returns {{strategyId: string, strategyName: string, scenarios: object[]}}
 */
export function getCgConservativeScenarioRegistration() {
  const scenarios = CG_CONSERVATIVE_SCENARIO_DETAILS.map((details) => ({
    id: details.id,
    name: details.title,
    layer: "DOMAIN",
    status: details.coverageStatus,
    executionStatus: "BLOCKED",
    executable: false,
    readinessReasons: [EXECUTION_BLOCK_REASON],
    details,
  }))
  return deepFreeze({
    strategyId: "CG-conservative",
    strategyName: "Conservative",
    scenarios,
  })
}
