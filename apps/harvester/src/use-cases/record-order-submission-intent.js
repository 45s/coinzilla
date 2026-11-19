import { CanonicalOrder } from "@coinzilla/entities"
import { addDecimal, compareDecimal, toResult } from "@coinzilla/utils"
import {
  isCanonicalDecimalString,
  isPositiveCanonicalDecimalString,
} from "../infrastructure/operational-state/helpers/operational-state-decimal-validation.js"

const SUPPORTED_PURPOSES = new Set([null, "RECOVERY_BUY", "RECOVERY_SELL"])

function validateCanonicalMarketIdentity({ market }) {
  const requiredMarketValues = [
    market?.id,
    market?.venue,
    market?.symbol,
    market?.baseAsset?.id,
    market?.quoteAsset?.id,
  ]
  if (requiredMarketValues.some((value) => typeof value !== "string" || !value.trim())) {
    throw new TypeError("Order-submission intent requires complete canonical market and asset identities")
  }
}

function validateSubmissionOrderFields({ order }) {
  if ((order.side !== "BUY" && order.side !== "SELL") ||
      (order.type !== "LIMIT" && order.type !== "LIMIT_MAKER")) {
    throw new TypeError("Order-submission intent has an unsupported side or order type")
  }
  const price = order.limitPrice?.amount
  const quantity = order.originalQuantity?.amount
  if (typeof price !== "string" || typeof quantity !== "string") {
    throw new TypeError("Order-submission intent requires exact decimal price and quantity strings")
  }
  return {
    price,
    quantity,
  }
}

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

function validateSubmissionIntent({ operationalStateStore, order, purpose, ownership }) {
  if (typeof operationalStateStore?.append !== "function") {
    throw new TypeError("recordOrderSubmissionIntent requires a Operational State Store append capability")
  }
  if (!(order instanceof CanonicalOrder)) {
    throw new TypeError("recordOrderSubmissionIntent requires a canonical order")
  }
  if (order.status !== "PENDING" || order.brokerOrderId != null) {
    throw new TypeError("Order-submission intent must identify a PENDING order without broker acknowledgement")
  }
  if (!SUPPORTED_PURPOSES.has(purpose)) {
    throw new TypeError("Order-submission intent purpose must be null or RECOVERY_SELL")
  }
  const { market } = order
  for (const field of ["providerInstanceId", "providerType", "accountId"]) {
    if (typeof order[field] !== "string" || !order[field].trim()) {
      throw new TypeError(`Order-submission intent requires immutable ${field} provenance`)
    }
  }
  validateCanonicalMarketIdentity({ market })
  const { price, quantity } = validateSubmissionOrderFields({ order })
  return {
    market,
    clientOrderId: order.clientOrderId,
    price,
    quantity,
    ownership: validateSubmissionOwnership({
      purpose,
      ownership,
      side: order.side,
      quantity,
    }),
  }
}

/**
 * Persist the immutable canonical order intent before the broker placement side effect.
 *
 * @param {object} options
 * @param {object} options.operationalStateStore - Initialized ADR-0001 Operational State Store append capability.
 * @param {CanonicalOrder} options.order - Validated PENDING canonical order.
 * @param {string|null} options.purpose - Explicit application strategy purpose.
 * @returns {Promise<object>} Durable append result; success requires durable === true.
 */
export async function recordOrderSubmissionIntent(options = {}) {
  try {
    const { operationalStateStore, order, purpose = null } = options
    const { market, clientOrderId, price, quantity, ownership } = validateSubmissionIntent({
      ...options,
      purpose,
    })
    const result = await operationalStateStore.append({
      factId: `order-submission-intent:${clientOrderId}`,
      factType: "ORDER_SUBMISSION_INTENT",
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
        price,
        quantity,
        purpose,
        ...ownership,
      },
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return toResult({
        errors: result?.errors?.length
          ? result.errors
          : [new Error("Order-submission intent append did not confirm durable commitment")],
      })
    }
    return result
  } catch (error) {
    return toResult({ error })
  }
}
