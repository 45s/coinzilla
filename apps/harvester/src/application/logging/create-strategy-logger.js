import { strategyLogMarkers } from "./strategy-log-markers.js"

const STRATEGY_LOG_METHODS = Object.freeze([
  "trace",
  "debug",
  "info",
  "warn",
  "warning",
  "error",
  "success",
  "system",
])

function createStrategyLogData({ data, strategyId } = {}) {
  if (data instanceof Error) {
    return {
      message: data.message,
      error: data,
      strategyId,
    }
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return {
      ...data,
      strategyId: Object.hasOwn(strategyLogMarkers, data.strategyId)
        ? data.strategyId
        : strategyId,
    }
  }
  return {
    message: String(data ?? ""),
    strategyId,
  }
}

/** Add immutable strategy ownership to every structured log emitted by a strategy workflow. */
export function createStrategyLogger({ logger, strategyId } = {}) {
  if (!logger || typeof logger !== "object") {
    throw new TypeError("Strategy logger requires a shared logger")
  }
  if (!Object.hasOwn(strategyLogMarkers, strategyId)) {
    throw new TypeError("Strategy logger requires a supported strategy ID")
  }

  const strategyLogger = Object.fromEntries(
    STRATEGY_LOG_METHODS.map((method) => [
      method,
      (data) => {
        if (typeof logger[method] !== "function") {
          return undefined
        }
        return logger[method](createStrategyLogData({
          data,
          strategyId,
        }))
      },
    ]),
  )
  return Object.freeze(strategyLogger)
}
