export function createScenarioWorkerDispatcher({ adapters } = {}) {
  if (!Array.isArray(adapters)) {
    throw new TypeError("Scenario worker dispatcher requires an adapter list")
  }
  const registry = new Map()
  for (const adapter of adapters) {
    if (typeof adapter?.strategyId !== "string" || !adapter.strategyId.trim() ||
        typeof adapter.execute !== "function") {
      throw new TypeError("Each scenario worker adapter requires a strategy ID and execute function")
    }
    if (registry.has(adapter.strategyId)) {
      throw new TypeError(`Duplicate scenario worker adapter for strategy "${adapter.strategyId}"`)
    }
    registry.set(adapter.strategyId, adapter.execute)
  }
  return async function dispatchScenarioWorkerRequest({ request, signal } = {}) {
    if (signal?.aborted) {
      throw new Error("Scenario worker was cancelled")
    }
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new TypeError("Scenario worker request must be an object")
    }
    if (request.type !== "execute") {
      throw new TypeError("Scenario worker request type must be execute")
    }
    if (typeof request.runId !== "string" || !request.runId.trim() ||
        typeof request.strategyId !== "string" || !request.strategyId.trim() ||
        typeof request.scenarioId !== "string" || !request.scenarioId.trim()) {
      throw new TypeError("Scenario worker request requires run, strategy and scenario identity")
    }
    const execute = registry.get(request.strategyId)
    if (!execute) {
      throw new Error(`No isolated worker adapter is registered for strategy "${request.strategyId}"`)
    }
    return execute({ ...request, signal })
  }
}
