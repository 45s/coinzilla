export function createScenarioDefinition(definition = {}) {
  return {
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
  }
}
