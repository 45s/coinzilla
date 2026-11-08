const DEFAULT_MAX_AGE_MS = 5_000
const DEFAULT_MAX_FUTURE_SKEW_MS = 1_000

/**
 * Decide whether a normalized market-data timestamp is fresh enough to use.
 *
 * @param {object} input
 * @param {number} input.timestamp Event timestamp in milliseconds.
 * @param {number} input.now Current time in milliseconds, supplied by the caller.
 * @param {number} [input.maxAgeMs] Maximum accepted age.
 * @param {number} [input.maxFutureSkewMs] Maximum accepted clock skew into the future.
 * @returns {boolean} Whether the timestamp falls within the inclusive freshness window.
 */
export function isMarketDataFresh({
  timestamp,
  now,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS,
} = {}) {
  const ageMs = now - timestamp
  return Number.isSafeInteger(ageMs) &&
    ageMs >= -maxFutureSkewMs &&
    ageMs <= maxAgeMs
}
