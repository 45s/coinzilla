import { SystemCustomError } from "@coinzilla/errors"

export class StrategySafetyPauseIncompleteError extends SystemCustomError {
  constructor({
    symbol,
    reason,
    unresolvedOrderCount = 0,
    failureCount = 0,
    cause,
  } = {}) {
    super(`Strategy safety pause for ${symbol} is incomplete`, {
      code: "STRATEGY_SAFETY_PAUSE_INCOMPLETE",
      context: {
        symbol,
        reason,
        unresolvedOrderCount,
        failureCount,
      },
      cause,
      retryable: true,
    })
  }
}
