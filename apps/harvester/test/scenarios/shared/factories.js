import { defineConservativeScenario } from "../conservative/registry/define-scenario.js"

export function createScenarioDefinition(definition = {}) {
  return defineConservativeScenario({
    tags: [],
    preconditions: [],
    initialState: {},
    inputEvents: [],
    invariants: [],
    relatedRequirements: [],
    relatedCriticalBehaviors: [],
    relatedSourceFiles: [],
    relatedExistingTests: [],
    ...definition,
  })
}
