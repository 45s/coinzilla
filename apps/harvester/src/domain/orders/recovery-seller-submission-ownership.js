import { StrategyId } from "../strategies/strategy-ids.js"

const IDENTIFIER_MAX_LENGTH = 256
const CONSERVATIVE_PURPOSES = new Set(["CONSERVATIVE_BUY", "CONSERVATIVE_SELL", "RECOVERY_SELL"])
const RECOVERY_SELLER_PURPOSES = new Set(["RECOVERY_BUY", "RECOVERY_SELL"])

function requireIdentifier({ value, field } = {}) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > IDENTIFIER_MAX_LENGTH) {
    throw new TypeError(`Submission ownership requires a valid ${field}`)
  }
  return value.trim()
}

function expectedSubmissionSide({ purpose } = {}) {
  if (purpose === "RECOVERY_BUY" || purpose === "CONSERVATIVE_BUY") {
    return "BUY"
  }
  if (purpose === "RECOVERY_SELL" || purpose === "CONSERVATIVE_SELL") {
    return "SELL"
  }
  return undefined
}

function validateOrderIdentity({ order, ownership } = {}) {
  if (ownership.clientOrderId !== undefined &&
      ownership.clientOrderId !== order?.clientOrderId) {
    throw new TypeError("Submission ownership clientOrderId must match its canonical order")
  }
  if (ownership.brokerOrderId !== undefined &&
      ownership.brokerOrderId !== order?.brokerOrderId) {
    throw new TypeError("Submission ownership brokerOrderId must match its canonical order")
  }
}

function normalizeSubmissionOwnership({ order, purpose, ownership } = {}) {
  const expectedSide = expectedSubmissionSide({ purpose })
  if (expectedSide === undefined || order?.side !== expectedSide) {
    throw new TypeError("Recovery submission purpose must match its canonical order side")
  }
  if (ownership === null || typeof ownership !== "object" || Array.isArray(ownership)) {
    throw new TypeError("Recovery submission requires explicit strategy and Position ownership")
  }
  if (ownership.purpose !== purpose) {
    throw new TypeError("Submission ownership strategy and purpose must match the canonical intent")
  }
  validateOrderIdentity({ order, ownership })

  const positionId = requireIdentifier({
    value: ownership.positionId,
    field: "positionId",
  })

  if (ownership.strategyId === StrategyId.COIN_GRABBER && CONSERVATIVE_PURPOSES.has(purpose)) {
    if (ownership.cycleId !== undefined) {
      throw new TypeError("Conservative submission ownership must not contain a Recovery Seller cycleId")
    }
    return Object.freeze({
      strategyId: StrategyId.COIN_GRABBER,
      positionId,
    })
  }

  if (ownership.strategyId === StrategyId.RECOVERY_SELLER && RECOVERY_SELLER_PURPOSES.has(purpose)) {
    return Object.freeze({
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId,
      cycleId: requireIdentifier({
        value: ownership.cycleId,
        field: "cycleId",
      }),
    })
  }

  throw new TypeError("Submission ownership must match a supported strategy and purpose")
}

/**
 * Validate immutable originating-strategy ownership before a submission fact is persisted.
 * CG is Position-scoped; RS is Position- and cycle-scoped. Ordinary purpose-null
 * orders may be unowned, but every strategy purpose requires explicit ownership.
 *
 * @param {object} input
 * @param {object} input.order Canonical pending or acknowledged order.
 * @param {string|null} input.purpose Explicit strategy purpose.
 * @param {object} [input.ownership] Strategy ownership metadata.
 * @returns {object|undefined} Normalized ownership fields for durable facts.
 */
export function validateStrategySubmissionOwnership({ order, purpose, ownership } = {}) {
  if (purpose === null) {
    if (ownership !== undefined) {
      throw new TypeError("Unowned order submissions cannot persist strategy ownership")
    }
    return undefined
  }
  return normalizeSubmissionOwnership({
    order,
    purpose,
    ownership,
  })
}


// Compatibility alias for Recovery Seller accounting callers during migration.
export const validateRecoverySellerSubmissionOwnership = validateStrategySubmissionOwnership
