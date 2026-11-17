import { requireNonEmptyString } from "../operational-state-canonical.js"
import { MAX_FACT_ID_LENGTH } from "./operational-state-fact-schema.js"
import {
  isCanonicalDecimalString,
  isPositiveCanonicalDecimalString,
} from "./operational-state-decimal-validation.js"

function factIdForOrderIntent(clientOrderId) {
  return `order-submission-intent:${  clientOrderId}`
}

function factIdForCancellationIntent(...parameters) {
  const [clientOrderId, reason, status, executedQuantity] = parameters
  return `order-cancellation-intent:${  clientOrderId  }:${  reason  }:${  status  }:${  executedQuantity}`
}

function factIdForCancellationOutcome(...parameters) {
  const [clientOrderId, reason, outcome] = parameters
  return `order-cancellation-outcome:${  clientOrderId  }:${  reason  }:${  outcome}`
}

function factIdForOrderOutcome(...parameters) {
  const [clientOrderId, outcome] = parameters
  return `order-submission-outcome:${  clientOrderId  }:${  outcome}`
}

export function validateOrderSubmissionIntentFact({ factType, canonicalData, factId }) {
  if (factType === "ORDER_SUBMISSION_INTENT") {
    const allowedFields = new Set([
      "clientOrderId",
      "marketId",
      "venue",
      "symbol",
      "baseAssetId",
      "quoteAssetId",
      "side",
      "type",
      "price",
      "quantity",
      "purpose",
    ])
    if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
      throw new TypeError("Order-submission intent fact contains unsupported fields")
    }
    const clientOrderId = requireNonEmptyString({
      value: canonicalData.clientOrderId,
      field: "data.clientOrderId",
      maxLength: MAX_FACT_ID_LENGTH,
    })
    requireNonEmptyString({ value: canonicalData.marketId,
field: "data.marketId",
maxLength: MAX_FACT_ID_LENGTH })
    requireNonEmptyString({ value: canonicalData.venue,
field: "data.venue",
maxLength: 32 })
    requireNonEmptyString({ value: canonicalData.baseAssetId,
field: "data.baseAssetId",
maxLength: MAX_FACT_ID_LENGTH })
    requireNonEmptyString({ value: canonicalData.quoteAssetId,
field: "data.quoteAssetId",
maxLength: MAX_FACT_ID_LENGTH })
    if (factIdForOrderIntent(clientOrderId) !== factId) {
      throw new TypeError("Order-submission intent factId must match its stable clientOrderId identity")
    }
    if (typeof canonicalData.symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(canonicalData.symbol)) {
      throw new TypeError("Order-submission intent symbol must be canonical uppercase alphanumeric")
    }
    if (canonicalData.side !== "BUY" && canonicalData.side !== "SELL") {
      throw new TypeError("Order-submission intent side must be BUY or SELL")
    }
    if (canonicalData.type !== "LIMIT" && canonicalData.type !== "LIMIT_MAKER") {
      throw new TypeError("Order-submission intent type must be LIMIT or LIMIT_MAKER")
    }
    const isPositiveDecimalString = (value) =>
      typeof value === "string" &&
      /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) &&
      /[1-9]/.test(value)
    if (!isPositiveDecimalString(canonicalData.price) || !isPositiveDecimalString(canonicalData.quantity)) {
      throw new TypeError("Order-submission intent price and quantity must be positive exact decimal strings")
    }
    if (canonicalData.purpose !== null && canonicalData.purpose !== "RECOVERY_SELL") {
      throw new TypeError("Order-submission intent purpose must be null or RECOVERY_SELL")
    }
  }
}

function validateOrderSubmissionOutcomeIdentity({ canonicalData, factId, clientOrderId }) {
  if (factIdForOrderOutcome(clientOrderId, canonicalData.outcome) !== factId) {
    throw new TypeError("Order-submission outcome factId must match its stable clientOrderId and outcome identity")
  }
  if (typeof canonicalData.symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(canonicalData.symbol)) {
    throw new TypeError("Order-submission outcome symbol must be canonical uppercase alphanumeric")
  }
  if (canonicalData.side !== "BUY" && canonicalData.side !== "SELL") {
    throw new TypeError("Order-submission outcome side must be BUY or SELL")
  }
  if (canonicalData.type !== "LIMIT" && canonicalData.type !== "LIMIT_MAKER") {
    throw new TypeError("Order-submission outcome type must be LIMIT or LIMIT_MAKER")
  }
}

function validateOrderSubmissionOutcomeAmounts({ canonicalData }) {
  if (
    !isPositiveCanonicalDecimalString({ value: canonicalData.price }) ||
    !isPositiveCanonicalDecimalString({ value: canonicalData.quantity }) ||
    !isCanonicalDecimalString({ value: canonicalData.executedQuantity })
  ) {
    throw new TypeError("Order-submission outcome amounts must be canonical exact decimal strings")
  }
}

function validateOrderSubmissionOutcomeState({ canonicalData }) {
  if (canonicalData.purpose !== null && canonicalData.purpose !== "RECOVERY_SELL") {
    throw new TypeError("Order-submission outcome purpose must be null or RECOVERY_SELL")
  }
  if (!["ACKNOWLEDGED", "REJECTED", "REJECTED_OR_UNKNOWN", "UNKNOWN"].includes(canonicalData.outcome)) {
    throw new TypeError("Order-submission outcome classification is unsupported")
  }
  requireNonEmptyString({ value: canonicalData.status,
field: "data.status",
maxLength: 32 })
  if (canonicalData.outcome === "ACKNOWLEDGED") {
    requireNonEmptyString({
      value: canonicalData.brokerOrderId,
      field: "data.brokerOrderId",
      maxLength: MAX_FACT_ID_LENGTH,
    })
    if (canonicalData.status === "PENDING") {
      throw new TypeError("Acknowledged order-submission outcome cannot have PENDING status")
    }
  } else if (
    canonicalData.brokerOrderId !== null ||
    canonicalData.status !== "PENDING" ||
    canonicalData.executedQuantity !== "0"
  ) {
    throw new TypeError("Unacknowledged order-submission outcome must preserve a PENDING order without broker identity or execution")
  }
}

export function validateOrderSubmissionOutcomeFact({ factType, canonicalData, factId }) {
  if (factType !== "ORDER_SUBMISSION_OUTCOME") {
    return
  }
  const allowedFields = new Set([
    "clientOrderId",
    "marketId",
    "venue",
    "symbol",
    "baseAssetId",
    "quoteAssetId",
    "side",
    "type",
    "price",
    "quantity",
    "executedQuantity",
    "purpose",
    "outcome",
    "brokerOrderId",
    "status",
  ])
  if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
    throw new TypeError("Order-submission outcome fact contains unsupported fields")
  }
  const clientOrderId = requireNonEmptyString({
    value: canonicalData.clientOrderId,
    field: "data.clientOrderId",
    maxLength: MAX_FACT_ID_LENGTH,
  })
  requireNonEmptyString({ value: canonicalData.marketId,
field: "data.marketId",
maxLength: MAX_FACT_ID_LENGTH })
  requireNonEmptyString({ value: canonicalData.venue,
field: "data.venue",
maxLength: 32 })
  requireNonEmptyString({ value: canonicalData.baseAssetId,
field: "data.baseAssetId",
maxLength: MAX_FACT_ID_LENGTH })
  requireNonEmptyString({ value: canonicalData.quoteAssetId,
field: "data.quoteAssetId",
maxLength: MAX_FACT_ID_LENGTH })
  validateOrderSubmissionOutcomeIdentity({ canonicalData,
factId,
clientOrderId })
  validateOrderSubmissionOutcomeAmounts({ canonicalData })
  validateOrderSubmissionOutcomeState({ canonicalData })
}

function validateCancellationIdentity({ canonicalData, factId, clientOrderId, reason, expectedFactId, outcome }) {
  const isValidReason = /^[A-Z][A-Z0-9_]{1,63}$/.test(reason)
  const isValidOutcome = outcome === undefined ||
    ["CANCELED", "FILLED", "REJECTED", "EXPIRED", "NOT_CANCELED", "NOT_SENT", "OUTCOME_UNKNOWN", "UNCONFIRMED", "UNKNOWN"].includes(outcome)
  if (
    !isValidReason ||
    !isValidOutcome ||
    canonicalData.venue !== canonicalData.venue.toLowerCase() ||
    canonicalData.marketId !== `${canonicalData.venue  }:${  canonicalData.symbol}` ||
    factId !== expectedFactId
  ) {
    throw new TypeError(outcome === undefined
      ? "Order-cancellation intent identity or reason is not canonical"
      : "Order-cancellation outcome identity or classification is not canonical")
  }
}

function validateCancellationOrderFields({ canonicalData, outcome }) {
  if (typeof canonicalData.symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(canonicalData.symbol)) {
    throw new TypeError(outcome === undefined
      ? "Order-cancellation symbol must be canonical uppercase alphanumeric"
      : "Order-cancellation outcome symbol must be canonical uppercase alphanumeric")
  }
  if (canonicalData.side !== "BUY" && canonicalData.side !== "SELL") {
    throw new TypeError(outcome === undefined
      ? "Order-cancellation side must be BUY or SELL"
      : "Order-cancellation outcome side must be BUY or SELL")
  }
}

function validateCancellationIntentState({ canonicalData }) {
  if (canonicalData.type !== "LIMIT" && canonicalData.type !== "LIMIT_MAKER") {
    throw new TypeError("Order-cancellation type must be LIMIT or LIMIT_MAKER")
  }
  if (canonicalData.status !== "OPEN" && canonicalData.status !== "PARTIALLY_FILLED") {
    throw new TypeError("Order-cancellation intent requires an active acknowledged order")
  }
  if (
    !isPositiveCanonicalDecimalString({ value: canonicalData.price }) ||
    !isPositiveCanonicalDecimalString({ value: canonicalData.quantity }) ||
    !isCanonicalDecimalString({ value: canonicalData.executedQuantity })
  ) {
    throw new TypeError("Order-cancellation amounts must be exact canonical decimal strings")
  }
}

function validateCancellationOutcomeState({ canonicalData }) {
  const confirmedStatuses = ["CANCELED", "FILLED", "REJECTED", "EXPIRED"]
  if (confirmedStatuses.includes(canonicalData.outcome)) {
    if (canonicalData.status !== canonicalData.outcome || !isCanonicalDecimalString({ value: canonicalData.executedQuantity })) {
      throw new TypeError("Confirmed cancellation outcome must preserve its canonical terminal state")
    }
  } else if (canonicalData.outcome === "NOT_CANCELED") {
    if (!["OPEN", "PARTIALLY_FILLED"].includes(canonicalData.status) || !isCanonicalDecimalString({ value: canonicalData.executedQuantity })) {
      throw new TypeError("NOT_CANCELED outcome must preserve the still-active canonical order state")
    }
  } else if (canonicalData.status !== null || canonicalData.executedQuantity !== null) {
    throw new TypeError("Unconfirmed cancellation outcome cannot invent a canonical order state")
  }
}

export function validateOrderCancellationIntentFact({ factType, canonicalData, factId }) {
  if (factType !== "ORDER_CANCELLATION_INTENT") {
    return
  }
  const allowedFields = new Set(["clientOrderId", "brokerOrderId", "marketId", "venue", "symbol", "baseAssetId", "quoteAssetId", "side", "type", "price", "quantity", "executedQuantity", "reason", "status"])
  if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
    throw new TypeError("Order-cancellation intent fact contains unsupported fields")
  }
  const clientOrderId = requireNonEmptyString({ value: canonicalData.clientOrderId, field: "data.clientOrderId", maxLength: MAX_FACT_ID_LENGTH })
  requireNonEmptyString({ value: canonicalData.brokerOrderId, field: "data.brokerOrderId", maxLength: MAX_FACT_ID_LENGTH })
  const marketId = requireNonEmptyString({ value: canonicalData.marketId, field: "data.marketId", maxLength: MAX_FACT_ID_LENGTH })
  const venue = requireNonEmptyString({ value: canonicalData.venue, field: "data.venue", maxLength: 32 })
  requireNonEmptyString({ value: canonicalData.baseAssetId, field: "data.baseAssetId", maxLength: MAX_FACT_ID_LENGTH })
  requireNonEmptyString({ value: canonicalData.quoteAssetId, field: "data.quoteAssetId", maxLength: MAX_FACT_ID_LENGTH })
  const reason = requireNonEmptyString({ value: canonicalData.reason, field: "data.reason", maxLength: 64 })
  validateCancellationIdentity({
    canonicalData: { ...canonicalData, marketId, venue },
    factId,
    clientOrderId,
    reason,
    expectedFactId: factIdForCancellationIntent(clientOrderId, reason, canonicalData.status, canonicalData.executedQuantity),
  })
  validateCancellationOrderFields({ canonicalData })
  validateCancellationIntentState({ canonicalData })
}

export function validateOrderCancellationOutcomeFact({ factType, canonicalData, factId }) {
  if (factType !== "ORDER_CANCELLATION_OUTCOME") {
    return
  }
  const allowedFields = new Set(["clientOrderId", "brokerOrderId", "marketId", "venue", "symbol", "baseAssetId", "quoteAssetId", "side", "reason", "outcome", "status", "executedQuantity"])
  if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
    throw new TypeError("Order-cancellation outcome fact contains unsupported fields")
  }
  const clientOrderId = requireNonEmptyString({ value: canonicalData.clientOrderId, field: "data.clientOrderId", maxLength: MAX_FACT_ID_LENGTH })
  requireNonEmptyString({ value: canonicalData.brokerOrderId, field: "data.brokerOrderId", maxLength: MAX_FACT_ID_LENGTH })
  const marketId = requireNonEmptyString({ value: canonicalData.marketId, field: "data.marketId", maxLength: MAX_FACT_ID_LENGTH })
  const venue = requireNonEmptyString({ value: canonicalData.venue, field: "data.venue", maxLength: 32 })
  requireNonEmptyString({ value: canonicalData.baseAssetId, field: "data.baseAssetId", maxLength: MAX_FACT_ID_LENGTH })
  requireNonEmptyString({ value: canonicalData.quoteAssetId, field: "data.quoteAssetId", maxLength: MAX_FACT_ID_LENGTH })
  const reason = requireNonEmptyString({ value: canonicalData.reason, field: "data.reason", maxLength: 64 })
  validateCancellationIdentity({
    canonicalData: { ...canonicalData, marketId, venue },
    factId,
    clientOrderId,
    reason,
    expectedFactId: factIdForCancellationOutcome(clientOrderId, reason, canonicalData.outcome),
    outcome: canonicalData.outcome,
  })
  validateCancellationOrderFields({ canonicalData, outcome: canonicalData.outcome })
  validateCancellationOutcomeState({ canonicalData })
}
