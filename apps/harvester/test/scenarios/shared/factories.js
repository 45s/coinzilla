import { defineConservativeScenario } from "../conservative/registry/define-scenario.js"

export function createScenarioDefinition(definition = {}) {
  return defineConservativeScenario({
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
    ...definition,
  })
}
