export function createUnavailableScenarioAdapter({
  strategyId,
  reason = "No trusted OS-level sandbox launcher is configured for this strategy",
} = {}) {
  if (typeof strategyId !== "string" || strategyId.trim().length === 0) {
    throw new TypeError("Unavailable scenario adapter requires a non-empty strategyId")
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new TypeError("Unavailable scenario adapter requires a non-empty readiness reason")
  }
  return Object.freeze({
    strategyId,
    executionMode: "simulation-only",
    osSandboxVerified: false,
    readinessReason: reason,
    execute: async () => ({
      ok: false,
      errors: [new Error(reason)],
    }),
  })
}
