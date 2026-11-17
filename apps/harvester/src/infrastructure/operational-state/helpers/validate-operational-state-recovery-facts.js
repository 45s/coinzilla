import { addDecimal, compareDecimal, subtractDecimal } from "@coinzilla/utils"
import {
  requireNonEmptyString,
  sha256OperationalStateValue,
} from "../operational-state-canonical.js"
import {
  MAX_FACT_ID_LENGTH,
  SHA256_PATTERN,
} from "./operational-state-fact-schema.js"
import {
  isCanonicalDecimalString,
  isPositiveCanonicalDecimalString,
  isSignedCanonicalDecimalString,
} from "./operational-state-decimal-validation.js"

function factIdForRecoveryCycle(...parameters) {
  const [marketId, cycleId] = parameters
  return `recovery-cycle-completed:${  marketId  }:${  cycleId}`
}

function validateRecoveryCycleAssetIds({ canonicalData }) {
  requireNonEmptyString({
    value: canonicalData.baseAssetId,
    field: "data.baseAssetId",
    maxLength: MAX_FACT_ID_LENGTH,
  })
  requireNonEmptyString({
    value: canonicalData.quoteAssetId,
    field: "data.quoteAssetId",
    maxLength: MAX_FACT_ID_LENGTH,
  })
}

function validateRecoveryCycleCompletedIdentity({ canonicalData, factId }) {
  const cycleId = requireNonEmptyString({
    value: canonicalData.cycleId,
    field: "data.cycleId",
    maxLength: 64,
  })
  const marketId = requireNonEmptyString({
    value: canonicalData.marketId,
    field: "data.marketId",
    maxLength: MAX_FACT_ID_LENGTH,
  })
  const venue = requireNonEmptyString({ value: canonicalData.venue,
field: "data.venue",
maxLength: 32 })
  const sellOrderClientId = requireNonEmptyString({
    value: canonicalData.sellOrderClientId,
    field: "data.sellOrderClientId",
    maxLength: MAX_FACT_ID_LENGTH,
  })
  const sellOrderBrokerOrderId = requireNonEmptyString({
    value: canonicalData.sellOrderBrokerOrderId,
    field: "data.sellOrderBrokerOrderId",
    maxLength: MAX_FACT_ID_LENGTH,
  })
  validateRecoveryCycleAssetIds({ canonicalData })
  if (
    !SHA256_PATTERN.test(cycleId) ||
    venue !== venue.toLowerCase() ||
    marketId !== `${venue}:${canonicalData.symbol}` ||
    factId !== factIdForRecoveryCycle(marketId, cycleId)
  ) {
    throw new TypeError("Recovery-cycle completion identity is not canonical")
  }
  if (typeof canonicalData.symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(canonicalData.symbol)) {
    throw new TypeError("Recovery-cycle symbol must be canonical uppercase alphanumeric")
  }
  if (canonicalData.baseAssetId === canonicalData.quoteAssetId) {
    throw new TypeError("Recovery-cycle base and quote assets must differ")
  }
  if (
    !Array.isArray(canonicalData.appliedFillIds) ||
    canonicalData.appliedFillIds.length === 0 ||
    canonicalData.appliedFillIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(canonicalData.appliedFillIds).size !== canonicalData.appliedFillIds.length
  ) {
    throw new TypeError("Recovery-cycle completion requires unique applied fill identities")
  }
  return { cycleId, marketId, sellOrderClientId, sellOrderBrokerOrderId }
}

function validateRecoveryCycleCompletedAmounts({ canonicalData }) {
  if (
    !isCanonicalDecimalString({ value: canonicalData.buyCost }) ||
    compareDecimal({ left: canonicalData.buyCost,
right: canonicalData.spent }) !== 0 ||
    !isCanonicalDecimalString({ value: canonicalData.netSellProceeds }) ||
    !isPositiveCanonicalDecimalString({ value: canonicalData.realizedNetProfit }) ||
    !isPositiveCanonicalDecimalString({ value: canonicalData.minProfit }) ||
    !isCanonicalDecimalString({ value: canonicalData.activeQuantity }) ||
    !isCanonicalDecimalString({ value: canonicalData.keepQuantity }) ||
    !isCanonicalDecimalString({ value: canonicalData.freeQuantity })
  ) {
    throw new TypeError("Recovery-cycle completion accounting values must be exact canonical decimals")
  }
  if (
    compareDecimal({
      left: canonicalData.realizedNetProfit,
      right: subtractDecimal({
        left: canonicalData.netSellProceeds,
        right: canonicalData.spent,
      }),
    }) !== 0 ||
    compareDecimal({ left: canonicalData.realizedNetProfit,
right: canonicalData.minProfit }) < 0 ||
    compareDecimal({ left: canonicalData.activeQuantity,
right: canonicalData.keepQuantity }) < 0 ||
    compareDecimal({ left: canonicalData.activeQuantity,
right: canonicalData.freeQuantity }) !== 0 ||
    compareDecimal({ left: canonicalData.minProfit,
right: "0.01" }) < 0
  ) {
    throw new TypeError("Recovery-cycle completion profit and inventory allocation must reconcile exactly")
  }
}

function validateRecoveryCycleDustMetadata({ dust }) {
  const dustFields = new Set([
    "status",
    "quantity",
    "reason",
    "minimumQuantity",
    "minimumNotional",
    "evaluatedQuantity",
    "evaluatedNotional",
    "quantityStepSize",
  ])
  if (
    !dust ||
    typeof dust !== "object" ||
    Array.isArray(dust) ||
    Object.keys(dust).some((key) => !dustFields.has(key)) ||
    dust.status !== "EXCHANGE_CONSTRAINED_DUST" ||
    !["MIN_QUANTITY", "MIN_NOTIONAL", "QUANTITY_INCREMENT"].includes(dust.reason) ||
    !isPositiveCanonicalDecimalString({ value: dust.quantity })
  ) {
    throw new TypeError("Recovery-cycle inventory disposition must be validated exchange-constrained dust")
  }
}

function validateRecoveryCycleDustDecimalEvidence({ dust }) {
  for (const field of ["minimumQuantity", "minimumNotional", "evaluatedQuantity", "evaluatedNotional", "quantityStepSize"]) {
    if (dust[field] !== undefined && !isCanonicalDecimalString({ value: dust[field] })) {
      throw new TypeError(`Recovery-cycle dust ${field} must be an exact decimal string`)
    }
  }
}

function validateRecoveryCycleDustReasonEvidence({ dust }) {
  if (
    dust.reason === "MIN_QUANTITY" &&
    (dust.minimumQuantity === undefined || dust.evaluatedQuantity === undefined)
  ) {
    throw new TypeError("MIN_QUANTITY dust requires its exchange minimum and evaluated quantity")
  }
  if (
    dust.reason === "MIN_NOTIONAL" &&
    (
      dust.minimumQuantity === undefined ||
      dust.minimumNotional === undefined ||
      dust.evaluatedQuantity === undefined ||
      dust.evaluatedNotional === undefined
    )
  ) {
    throw new TypeError("MIN_NOTIONAL dust requires exact quantity and notional evidence")
  }
  if (
    dust.reason === "QUANTITY_INCREMENT" &&
    (dust.quantityStepSize === undefined || dust.evaluatedQuantity !== "0")
  ) {
    throw new TypeError("QUANTITY_INCREMENT dust requires exact step-size evidence and zero evaluated quantity")
  }
}

function validateRecoveryCycleDustQuantity({ canonicalData, dust }) {
  if (
    compareDecimal({
      left: canonicalData.activeQuantity,
      right: addDecimal({
        left: canonicalData.keepQuantity,
        right: dust.quantity,
      }),
    }) !== 0
  ) {
    throw new TypeError("Recovery-cycle dust quantity must exactly reconcile the retained inventory allocation")
  }
}

function validateRecoveryCycleInventoryDisposition({ canonicalData }) {
  if (canonicalData.inventoryDisposition === null) {
    if (compareDecimal({ left: canonicalData.freeQuantity,
right: canonicalData.keepQuantity }) !== 0) {
      throw new TypeError("Recovery-cycle free quantity must equal keepQuantity when no dust is recorded")
    }
    return
  }
  const dust = canonicalData.inventoryDisposition
  validateRecoveryCycleDustMetadata({ dust })
  validateRecoveryCycleDustDecimalEvidence({ dust })
  validateRecoveryCycleDustReasonEvidence({ dust })
  validateRecoveryCycleDustQuantity({ canonicalData,
dust })
}

function validateRecoveryCycleCompletedIdentityDigest({ canonicalData, identity }) {
  const cycleIdentity = JSON.stringify([
    identity.marketId,
    identity.sellOrderClientId,
    identity.sellOrderBrokerOrderId,
    canonicalData.appliedFillIds,
    canonicalData.buyCost,
    canonicalData.spent,
    canonicalData.netSellProceeds,
    canonicalData.realizedNetProfit,
    canonicalData.minProfit,
    canonicalData.activeQuantity,
    canonicalData.keepQuantity,
    canonicalData.freeQuantity,
    canonicalData.inventoryDisposition,
  ])
  if (sha256OperationalStateValue(cycleIdentity) !== identity.cycleId) {
    throw new TypeError("Recovery-cycle ID must be derived from the exact fill, accounting, inventory, and terminal SELL identity")
  }
}

export function validateRecoveryCycleCompletedFact({ factType, canonicalData, factId }) {
  if (factType !== "RECOVERY_CYCLE_COMPLETED") {
    return
  }
  const allowedFields = new Set([
    "cycleId",
    "marketId",
    "venue",
    "symbol",
    "baseAssetId",
    "quoteAssetId",
    "appliedFillIds",
    "sellOrderClientId",
    "sellOrderBrokerOrderId",
    "buyCost",
    "spent",
    "netSellProceeds",
    "realizedNetProfit",
    "minProfit",
    "activeQuantity",
    "keepQuantity",
    "freeQuantity",
    "inventoryDisposition",
  ])
  if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
    throw new TypeError("Recovery-cycle completion fact contains unsupported fields")
  }
  const identity = validateRecoveryCycleCompletedIdentity({ canonicalData,
factId })
  validateRecoveryCycleCompletedAmounts({ canonicalData })
  validateRecoveryCycleInventoryDisposition({ canonicalData })
  validateRecoveryCycleCompletedIdentityDigest({ canonicalData,
identity })
}

function validateRecoveryCycleNotCompletedIdentity({ canonicalData, factId }) {
  const evaluationId = requireNonEmptyString({
    value: canonicalData.evaluationId,
    field: "data.evaluationId",
    maxLength: 64,
  })
  const marketId = requireNonEmptyString({
    value: canonicalData.marketId,
    field: "data.marketId",
    maxLength: MAX_FACT_ID_LENGTH,
  })
  const venue = requireNonEmptyString({ value: canonicalData.venue,
field: "data.venue",
maxLength: 32 })
  const sellOrderClientId = requireNonEmptyString({
    value: canonicalData.sellOrderClientId,
    field: "data.sellOrderClientId",
    maxLength: MAX_FACT_ID_LENGTH,
  })
  const sellOrderBrokerOrderId = requireNonEmptyString({
    value: canonicalData.sellOrderBrokerOrderId,
    field: "data.sellOrderBrokerOrderId",
    maxLength: MAX_FACT_ID_LENGTH,
  })
  validateRecoveryCycleAssetIds({ canonicalData })
  const reason = requireNonEmptyString({ value: canonicalData.reason,
field: "data.reason",
maxLength: 64 })
  if (
    !SHA256_PATTERN.test(evaluationId) ||
    venue !== venue.toLowerCase() ||
    marketId !== `${venue}:${canonicalData.symbol}` ||
    factId !== `recovery-cycle-not-completed:${marketId}:${evaluationId}` ||
    !/^[A-Z][A-Z0-9_]{1,63}$/.test(reason)
  ) {
    throw new TypeError("Recovery-cycle non-completion identity or reason is not canonical")
  }
  if (typeof canonicalData.symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(canonicalData.symbol)) {
    throw new TypeError("Recovery-cycle symbol must be canonical uppercase alphanumeric")
  }
  if (canonicalData.baseAssetId === canonicalData.quoteAssetId) {
    throw new TypeError("Recovery-cycle base and quote assets must differ")
  }
  if (
    !Array.isArray(canonicalData.appliedFillIds) ||
    canonicalData.appliedFillIds.length === 0 ||
    canonicalData.appliedFillIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(canonicalData.appliedFillIds).size !== canonicalData.appliedFillIds.length
  ) {
    throw new TypeError("Recovery-cycle non-completion requires unique applied fill identities")
  }
  return { evaluationId,
marketId,
sellOrderClientId,
sellOrderBrokerOrderId,
reason }
}

function validateRecoveryCycleNotCompletedAmounts({ canonicalData }) {
  if (
    !isCanonicalDecimalString({ value: canonicalData.buyCost }) ||
    compareDecimal({ left: canonicalData.buyCost,
right: canonicalData.spent }) !== 0 ||
    !isCanonicalDecimalString({ value: canonicalData.netSellProceeds }) ||
    !isSignedCanonicalDecimalString({ value: canonicalData.realizedNetProfit }) ||
    !isPositiveCanonicalDecimalString({ value: canonicalData.minProfit }) ||
    !isCanonicalDecimalString({ value: canonicalData.activeQuantity }) ||
    !isCanonicalDecimalString({ value: canonicalData.keepQuantity }) ||
    compareDecimal({
      left: canonicalData.realizedNetProfit,
      right: subtractDecimal({
        left: canonicalData.netSellProceeds,
        right: canonicalData.spent,
      }),
    }) !== 0 ||
    compareDecimal({ left: canonicalData.minProfit,
right: "0.01" }) < 0
  ) {
    throw new TypeError("Recovery-cycle non-completion accounting values must be exact and internally consistent")
  }
}

function validateRecoveryCycleNotCompletedOutcome({ canonicalData, reason }) {
  const continueReasons = new Set([
    "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
    "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY",
  ])
  if (canonicalData.outcome === "CONTINUE_SELL_THROUGH") {
    if (
      !continueReasons.has(reason) ||
      compareDecimal({ left: canonicalData.activeQuantity,
right: canonicalData.keepQuantity }) <= 0
    ) {
      throw new TypeError("CONTINUE_SELL_THROUGH requires an approved continuation reason and residual active inventory")
    }
    if (
      reason === "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH" &&
      compareDecimal({ left: canonicalData.realizedNetProfit,
right: canonicalData.minProfit }) < 0
    ) {
      throw new TypeError("Residual sell-through requires the minimum profit target to be met")
    }
    if (
      reason === "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY" &&
      compareDecimal({ left: canonicalData.realizedNetProfit,
right: canonicalData.minProfit }) >= 0
    ) {
      throw new TypeError("Profit-target continuation requires realized profit below minProfit")
    }
    return
  }
  if (canonicalData.outcome === "BLOCKED") {
    if (continueReasons.has(reason)) {
      throw new TypeError("A continue-sell-through reason cannot be persisted as BLOCKED")
    }
    if (
      reason === "RECOVERY_SELL_FAILED_MIN_PROFIT" &&
      compareDecimal({ left: canonicalData.realizedNetProfit,
right: canonicalData.minProfit }) >= 0
    ) {
      throw new TypeError("A minimum-profit blocker requires realized profit below minProfit")
    }
    return
  }
  throw new TypeError("Recovery-cycle non-completion outcome must be BLOCKED or CONTINUE_SELL_THROUGH")
}

function validateRecoveryCycleNotCompletedIdentityDigest({ canonicalData, identity }) {
  const evaluationIdentity = JSON.stringify([
    identity.marketId,
    identity.sellOrderClientId,
    identity.sellOrderBrokerOrderId,
    canonicalData.appliedFillIds,
    canonicalData.buyCost,
    canonicalData.spent,
    canonicalData.netSellProceeds,
    canonicalData.realizedNetProfit,
    canonicalData.minProfit,
    canonicalData.activeQuantity,
    canonicalData.keepQuantity,
    canonicalData.outcome,
    identity.reason,
  ])
  if (sha256OperationalStateValue(evaluationIdentity) !== identity.evaluationId) {
    throw new TypeError("Recovery-cycle evaluation ID must be derived from its exact fill, accounting, and terminal SELL identity")
  }
}

export function validateRecoveryCycleNotCompletedFact({ factType, canonicalData, factId }) {
  if (factType !== "RECOVERY_CYCLE_NOT_COMPLETED") {
    return
  }
  const allowedFields = new Set([
    "evaluationId",
    "marketId",
    "venue",
    "symbol",
    "baseAssetId",
    "quoteAssetId",
    "appliedFillIds",
    "sellOrderClientId",
    "sellOrderBrokerOrderId",
    "buyCost",
    "spent",
    "netSellProceeds",
    "realizedNetProfit",
    "minProfit",
    "activeQuantity",
    "keepQuantity",
    "outcome",
    "reason",
  ])
  if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
    throw new TypeError("Recovery-cycle non-completion fact contains unsupported fields")
  }
  const identity = validateRecoveryCycleNotCompletedIdentity({ canonicalData,
factId })
  validateRecoveryCycleNotCompletedAmounts({ canonicalData })
  validateRecoveryCycleNotCompletedOutcome({ canonicalData,
reason: identity.reason })
  validateRecoveryCycleNotCompletedIdentityDigest({ canonicalData,
identity })
}
