import { CanonicalOrder } from "@coinzilla/entities"
import { addDecimal, compareDecimal, toResult } from "@coinzilla/utils"
import {
  isCanonicalDecimalString,
  isPositiveCanonicalDecimalString,
} from "../infrastructure/operational-state/helpers/operational-state-decimal-validation.js"

const OUTCOMES = new Set(["ACKNOWLEDGED", "REJECTED", "REJECTED_OR_UNKNOWN", "UNKNOWN"])
const SUPPORTED_PURPOSES = new Set([null, "RECOVERY_BUY", "RECOVERY_SELL"])

function hasNonEmptyValue(value) {
  return typeof value === "string" && value.trim().length > 0
}

function validatePurposeFreeOwnership({ ownership } = {}) {
  if (!ownership) {
    return {}
  }
  const hasValidCycleId = ownership.cycleId === undefined || hasNonEmptyValue(ownership.cycleId)
  if (ownership.strategyId !== "CG_coinGrabber" ||
      ownership.purpose !== null ||
      !hasNonEmptyValue(ownership.positionId) ||
      !hasValidCycleId) {
    throw new TypeError("Purpose-free order ownership must be complete Coin Grabber ownership")
  }
  return {
    strategyId: ownership.strategyId,
    positionId: ownership.positionId,
    ...(ownership.cycleId ? { cycleId: ownership.cycleId } : {}),
  }
}

function validateStrategyPositionOwnership({ purpose, ownership } = {}) {
  const supportedStrategies = ["CG_coinGrabber", "RS_recoverySeller"]
  if (!supportedStrategies.includes(ownership?.strategyId) ||
      ownership.purpose !== purpose ||
      !hasNonEmptyValue(ownership.positionId)) {
    throw new TypeError("Strategy order submission requires complete strategy and position ownership")
  }
}

function validateRecoverySellerCycleOwnership({ ownership } = {}) {
  if (ownership.strategyId === "RS_recoverySeller" &&
      !hasNonEmptyValue(ownership.cycleId)) {
    throw new TypeError("Recovery Seller order submission requires its immutable cycleId")
  }
}

function validateRecoveryBuyOwnership({ purpose, ownership } = {}) {
  if (purpose === "RECOVERY_BUY" && ownership.strategyId !== "RS_recoverySeller") {
    throw new TypeError("RECOVERY_BUY ownership must belong to Recovery Seller")
  }
}

function validateRecoverySellAllocation({ purpose, ownership, quantity } = {}) {
  if (purpose !== "RECOVERY_SELL" || ownership.strategyId !== "RS_recoverySeller") {
    if (ownership.sellAllocation !== undefined) {
      throw new TypeError("Only Recovery Seller SELL ownership may contain a mixed SELL allocation")
    }
    return {}
  }
  const allocation = ownership.sellAllocation
  if (!allocation || typeof allocation !== "object" || Array.isArray(allocation) ||
      Object.keys(allocation).length !== 2 ||
      !isPositiveCanonicalDecimalString({ value: allocation.recoverySellQuantity }) ||
      !isCanonicalDecimalString({ value: allocation.legacySellQuantity }) ||
      compareDecimal({ left: allocation.legacySellQuantity, right: "0" }) < 0 ||
      compareDecimal({
        left: addDecimal({ left: allocation.recoverySellQuantity, right: allocation.legacySellQuantity }),
        right: quantity,
      }) !== 0) {
    throw new TypeError("Recovery Seller SELL requires an exact recovery/legacy allocation equal to the canonical order quantity")
  }
  return {
    sellAllocation: Object.freeze({
      recoverySellQuantity: allocation.recoverySellQuantity,
      legacySellQuantity: allocation.legacySellQuantity,
    }),
  }
}

function validateRecoveryPurposeSide({ purpose, side } = {}) {
  const expectedSide = purpose === "RECOVERY_BUY" ? "BUY" : "SELL"
  if (side !== expectedSide) {
    throw new TypeError("Recovery order purpose must match the canonical order side")
  }
}

function validatePurposeOwnership({ purpose, ownership, side, quantity } = {}) {
  const hasCycleId = hasNonEmptyValue(ownership?.cycleId)
  validateStrategyPositionOwnership({
    purpose,
    ownership,
  })
  validateRecoverySellerCycleOwnership({
    ownership,
  })
  validateRecoveryBuyOwnership({
    purpose,
    ownership,
  })
  validateRecoveryPurposeSide({
    purpose,
    side,
    quantity,
  })
  return {
    strategyId: ownership.strategyId,
    positionId: ownership.positionId,
    ...(hasCycleId ? { cycleId: ownership.cycleId } : {}),
    ...validateRecoverySellAllocation({ purpose, ownership, quantity }),
  }
}

function validateSubmissionOwnership({ purpose, ownership, side, quantity } = {}) {
  if (purpose === null) {
    return validatePurposeFreeOwnership({
      ownership,
    })
  }
  if (purpose === "RECOVERY_SELL" && !ownership) {
    return {}
  }
  return validatePurposeOwnership({
    purpose,
    ownership,
    side,
  })
}

function validateSubmissionStoreAndOrder({
    operationalStateStore,
    order,
    outcome,
    purpose,
    ownership,
  }) {
  if (typeof operationalStateStore?.append !== "function") {
    throw new TypeError("recordOrderSubmissionOutcome requires a Operational State Store append capability")
  }
  if (!(order instanceof CanonicalOrder)) {
    throw new TypeError("recordOrderSubmissionOutcome requires a canonical order")
  }
  if (!OUTCOMES.has(outcome)) {
    throw new TypeError("recordOrderSubmissionOutcome requires a supported submission outcome")
  }
  if (!SUPPORTED_PURPOSES.has(purpose)) {
    throw new TypeError("Order-submission outcome purpose must be null, RECOVERY_BUY or RECOVERY_SELL")
  }
  return validateSubmissionOwnership({
    purpose,
    ownership,
    side: order.side,
    quantity: order.originalQuantity.amount,
  })
}

function validateSubmissionAcknowledgement({
    order,
    outcome,
  }) {
  const acknowledged = outcome === "ACKNOWLEDGED"
  if (acknowledged !== (typeof order.brokerOrderId === "string" && order.status !== "PENDING")) {
    throw new TypeError("Submission outcome classification contradicts canonical broker acknowledgement state")
  }
  if (!acknowledged && order.executedQuantity.amount !== "0") {
    throw new TypeError("Unacknowledged submission outcome cannot contain an execution")
  }
  return acknowledged
}

function validateSubmissionMarket({ market }) {
  const requiredMarketValues = [
    market?.id,
    market?.venue,
    market?.symbol,
    market?.baseAsset?.id,
    market?.quoteAsset?.id,
  ]
  if (requiredMarketValues.some((value) => typeof value !== "string" || !value.trim())) {
    throw new TypeError("Order-submission outcome requires complete canonical market and asset identities")
  }
}

function validateSubmissionOrderType({ order }) {
  if ((order.side !== "BUY" && order.side !== "SELL") ||
      (order.type !== "LIMIT" && order.type !== "LIMIT_MAKER")) {
    throw new TypeError("Order-submission outcome has an unsupported side or order type")
  }
}

function validateSubmissionOutcome(options) {
  const { operationalStateStore, order, outcome, purpose } = options
  const ownershipFields = validateSubmissionStoreAndOrder({
    operationalStateStore,
    order,
    outcome,
    purpose,
    ownership: options.ownership,
  })
  const acknowledged = validateSubmissionAcknowledgement({
    order,
    outcome,
  })
  const { market } = order
  for (const field of ["providerInstanceId", "providerType", "accountId"]) {
    if (typeof order[field] !== "string" || !order[field].trim()) {
      throw new TypeError(`Order-submission outcome requires immutable ${field} provenance`)
    }
  }
  validateSubmissionMarket({
    market,
  })
  validateSubmissionOrderType({ order })
  return {
    market,
    clientOrderId: order.clientOrderId,
    acknowledged,
    ownership: ownershipFields,
  }
}

/**
 * Persist the broker's classified submission outcome before local order state advances.
 *
 * @param {object} options
 * @param {object} options.operationalStateStore - Initialized ADR-0001 Operational State Store append capability.
 * @param {CanonicalOrder} options.order - Canonical pending or broker-acknowledged order.
 * @param {string} options.outcome - ACKNOWLEDGED, REJECTED, REJECTED_OR_UNKNOWN, or UNKNOWN.
 * @param {string|null} options.purpose - Explicit application strategy purpose.
 * @returns {Promise<object>} Durable append result; success requires durable === true.
 */
export async function recordOrderSubmissionOutcome(options = {}) {
  try {
    const { operationalStateStore, order, outcome, purpose = null } = options
    const { market, clientOrderId, acknowledged, ownership } = validateSubmissionOutcome({
      ...options,
      purpose,
    })
    const result = await operationalStateStore.append({
      factId: `order-submission-outcome:${clientOrderId}:${outcome}`,
      factType: "ORDER_SUBMISSION_OUTCOME",
      data: {
        clientOrderId,
        providerInstanceId: order.providerInstanceId,
        providerType: order.providerType,
        accountId: order.accountId,
        marketId: market.id,
        venue: market.venue,
        symbol: market.symbol,
        baseAssetId: market.baseAsset.id,
        quoteAssetId: market.quoteAsset.id,
        side: order.side,
        type: order.type,
        price: order.limitPrice.amount,
        quantity: order.originalQuantity.amount,
        executedQuantity: order.executedQuantity.amount,
        purpose,
        ...ownership,
        outcome,
        brokerOrderId: acknowledged ? order.brokerOrderId : null,
        status: order.status,
      },
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return toResult({
        errors: result?.errors?.length
          ? result.errors
          : [new Error("Order-submission outcome append did not confirm durable commitment")],
      })
    }
    return result
  } catch (error) {
    return toResult({ error })
  }
}
