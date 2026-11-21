import { SystemCustomError } from "@coinzilla/utils"

/** Aggregate independent configured-market history failures without losing their causes. */
export class AccountHistorySynchronizationError extends SystemCustomError {
  /**
   * @param {{errors: Error[], marketCount: number}} options
   */
  constructor({ errors, marketCount } = {}) {
    if (!Array.isArray(errors) || errors.length === 0) {
      throw new TypeError("Account history synchronization errors must be a non-empty array")
    }
    if (!Number.isSafeInteger(marketCount) || marketCount < 1 || errors.length > marketCount) {
      throw new TypeError("Account history synchronization market count must cover every failure")
    }

    super(`Account history synchronization failed for ${errors.length} of ${marketCount} configured markets`, {
      code: "HARVESTER_ACCOUNT_HISTORY_SYNC_FAILED",
      context: {
        failureCount: errors.length,
        marketCount,
      },
      cause: new AggregateError([...errors], "One or more configured-market history scans failed"),
    })
  }
}
