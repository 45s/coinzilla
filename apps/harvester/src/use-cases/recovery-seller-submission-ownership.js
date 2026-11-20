import { StrategyId } from "../domain/strategies/strategy-ids.js"

const IDENTIFIER_MAX_LENGTH = 256

function requireIdentifier({ value, field } = {}) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > IDENTIFIER_MAX_LENGTH) {
    throw new TypeError(`Recovery Seller submission ownership requires a valid ${field}`)
  }
  return value.trim()
}

/**
 * Validate immutable strategy, Position, and cycle ownership before a submission fact is persisted.
 *
 * @param {object} input
 * @param {object} input.order Canonical pending or acknowledged order.
 * @param {string|null} input.purpose Explicit strategy purpose.
 * @param {object} [input.ownership] Strategy ownership metadata.
 * @returns {object|undefined} Normalized ownership fields for durable facts.
 */
export function validateRecoverySellerSubmissionOwnership({ order, purpose, ownership } = {}) {
  if (purpose === null) {
    if (ownership !== undefined) {
      throw new TypeError("Unowned order submissions cannot persist Recovery Seller ownership")
    }
    return undefined
  }
  const expectedPurpose = order?.side === "BUY" ? "RECOVERY_BUY" : "RECOVERY_SELL"
  if (purpose !== expectedPurpose) {
    throw new TypeError("Recovery Seller submission purpose must match its canonical order side")
  }
  if (ownership === null || typeof ownership !== "object" || Array.isArray(ownership)) {
    throw new TypeError("Recovery Seller submission requires explicit strategy, Position, and cycle ownership")
  }
  if (ownership.strategyId !== StrategyId.RECOVERY_SELLER || ownership.purpose !== purpose) {
    throw new TypeError("Recovery Seller submission ownership must match the Recovery Seller strategy and purpose")
  }
  return Object.freeze({
    strategyId: StrategyId.RECOVERY_SELLER,
    positionId: requireIdentifier({ value: ownership.positionId, field: "positionId" }),
    cycleId: requireIdentifier({ value: ownership.cycleId, field: "cycleId" }),
  })
}
