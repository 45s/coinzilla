import { CanonicalOrder } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"

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
  if (ownership.strategyId !== "COIN_GRABBER" ||
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

function validatePurposeOwnership({ purpose, ownership, side } = {}) {
  const isSupportedStrategy = ["COIN_GRABBER", "RECOVERY_SELLER"].includes(ownership?.strategyId)
  const hasCycleId = hasNonEmptyValue(ownership?.cycleId)
  if (!isSupportedStrategy ||
      ownership.purpose !== purpose ||
      !hasNonEmptyValue(ownership.positionId)) {
    throw new TypeError("Strategy order submission requires complete strategy and position ownership")
  }
  if (ownership.strategyId === "RECOVERY_SELLER" && !hasCycleId) {
    throw new TypeError("Recovery Seller order submission requires its immutable cycleId")
  }
  if (purpose === "RECOVERY_BUY" && ownership.strategyId !== "RECOVERY_SELLER") {
    throw new TypeError("RECOVERY_BUY ownership must belong to Recovery Seller")
  }
  if ((purpose === "RECOVERY_BUY" && side !== "BUY") ||
      (purpose === "RECOVERY_SELL" && side !== "SELL")) {
    throw new TypeError("Recovery order purpose must match the canonical order side")
  }
  return {
    strategyId: ownership.strategyId,
    positionId: ownership.positionId,
    ...(hasCycleId ? { cycleId: ownership.cycleId } : {}),
  }
}

function validateSubmissionOwnership({ purpose, ownership, side } = {}) {
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
