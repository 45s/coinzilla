export const TRADING_SESSION_REPOSITORY_METHODS = Object.freeze([
  "create",
  "findById",
  "transition",
])

export function assertTradingSessionRepository({ repository } = {}) {
  if (repository === null || typeof repository !== "object") {
    throw new TypeError("Harvester trading-session repository port must be an object")
  }
  const missing = TRADING_SESSION_REPOSITORY_METHODS.filter(
    (method) => typeof repository[method] !== "function",
  )
  if (missing.length > 0) {
    throw new TypeError(`Harvester trading-session repository port is missing methods: ${missing.join(", ")}`)
  }
  return repository
}
