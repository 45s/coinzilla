import { SystemCustomError } from "@coinzilla/utils"

export class StrategySafetyPauseIncompleteError extends SystemCustomError {
  constructor({ symbol, reason, unresolvedOrderCount = 0, failureCount = 0, cause } = {}) {
    super(
      `Conservative strategy safety pause is incomplete for ${symbol}`,
      {
        code: "STRATEGY_SAFETY_PAUSE_INCOMPLETE",
        context: {
          symbol,
          reason: reason ?? null,
          unresolvedOrderCount,
          failureCount,
        },
        ...(cause === undefined ? {} : { cause }),
        retryable: false,
      },
    )
  }
}
