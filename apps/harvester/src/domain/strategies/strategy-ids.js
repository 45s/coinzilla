export const StrategyId = Object.freeze({
  COIN_GRABBER: "CG_coinGrabber",
  RECOVERY_SELLER: "RS_recoverySeller",
})

/**
 * Normalize a strategy identifier while preserving support for future strategies.
 *
 * @param {object} options
 * @param {unknown} options.strategyId Strategy identifier to normalize.
 * @param {string} [options.errorMessage] Context-specific validation message.
 * @returns {string} Non-empty strategy identifier without surrounding whitespace.
 * @throws {TypeError} If the strategy identifier is missing, blank, or not a string.
 */
export function normalizeStrategyId({
  strategyId,
  errorMessage = "Strategy ID must be a non-empty string",
} = {}) {
  if (typeof strategyId !== "string" || !strategyId.trim()) {
    throw new TypeError(errorMessage)
  }
  return strategyId.trim()
}
