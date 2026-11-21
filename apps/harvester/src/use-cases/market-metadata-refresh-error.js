import { ensure, SystemCustomError } from "@coinzilla/utils"

export const MARKET_METADATA_REFRESH_ERROR_CODES = Object.freeze({
  EXCHANGE_FILTERS_UNAVAILABLE: "HARVESTER_MARKET_FILTERS_UNAVAILABLE",
  MARKET_IDENTITY_MISMATCH: "HARVESTER_MARKET_METADATA_MARKET_MISMATCH",
  CLOCK_MOVED_BACKWARDS: "HARVESTER_MARKET_METADATA_CLOCK_MOVED_BACKWARDS",
})

const ALLOWED_CODES = Object.values(MARKET_METADATA_REFRESH_ERROR_CODES)

/**
 * Actionable failure raised when current exchange market filters cannot be trusted.
 */
export class MarketMetadataRefreshError extends SystemCustomError {
  constructor({
    code,
    message,
    context = {},
    cause,
    retryable = false,
  } = {}) {
    ensure.oneOf({
      value: code,
      values: ALLOWED_CODES,
      name: "code",
    })
    ensure.nonEmptyString({
      value: message,
      name: "message",
    })
    ensure.plainObject({
      value: context,
      name: "context",
    })
    super(message, {
      code,
      context,
      retryable,
      ...(cause === undefined ? {} : { cause }),
    })
  }
}
