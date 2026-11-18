import { requireNonEmptyString } from "../operational-state-canonical.js"
import { MAX_FACT_ID_LENGTH } from "./operational-state-fact-schema.js"
import {
  isCanonicalDecimalString,
  isPositiveCanonicalDecimalString,
} from "./operational-state-decimal-validation.js"

function factIdForExecutionFill(fillId) {
  return `execution-fill-applied:${  fillId}`
}

function validateExecutionFillIdentity({ canonicalData, factId, fillId, tradeId, marketId, venue }) {
  if (
    canonicalData.baseAssetId === canonicalData.quoteAssetId ||
    venue !== venue.toLowerCase() ||
    marketId !== `${venue}:${canonicalData.symbol}` ||
    fillId !== `${marketId}:${tradeId}` ||
    factId !== factIdForExecutionFill(fillId)
  ) {
    throw new TypeError("Execution-fill fact identities must match its canonical market, trade and stable fact identity")
  }
}

function validateExecutionFillSideAndLiquidity({ canonicalData }) {
  if (typeof canonicalData.symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(canonicalData.symbol)) {
    throw new TypeError("Execution-fill symbol must be canonical uppercase alphanumeric")
  }
  if (canonicalData.side !== "BUY" && canonicalData.side !== "SELL") {
    throw new TypeError("Execution-fill side must be BUY or SELL")
  }
  if (!["MAKER", "TAKER", "UNKNOWN"].includes(canonicalData.liquidityRole)) {
    throw new TypeError("Execution-fill liquidity role is unsupported")
  }
}

function validateExecutionFillAmounts({ canonicalData }) {
  if (
    !isPositiveCanonicalDecimalString({ value: canonicalData.price }) ||
    !isPositiveCanonicalDecimalString({ value: canonicalData.quantity }) ||
    !isPositiveCanonicalDecimalString({ value: canonicalData.quoteQuantity })
  ) {
    throw new TypeError("Execution-fill price and quantities must be positive exact decimal strings")
  }
}

function validateExecutionFillCommissionStatus({ canonicalData }) {
  if (
    !["COMPLETE", "PARTIAL", "UNKNOWN"].includes(canonicalData.commissionStatus) ||
    !Array.isArray(canonicalData.commissions)
  ) {
    throw new TypeError("Execution-fill commission status or collection is invalid")
  }
  if (
    (canonicalData.commissionStatus === "UNKNOWN" && canonicalData.commissions.length !== 0) ||
    (canonicalData.commissionStatus === "PARTIAL" && canonicalData.commissions.length === 0)
  ) {
    throw new TypeError("Execution-fill commission entries contradict commission completeness")
  }
}

function validateExecutionFillCommissionEntry({ commission, quoteAssetId }) {
  if (
    !commission ||
    typeof commission !== "object" ||
    Array.isArray(commission) ||
    Object.keys(commission).some((key) => !["amount", "assetId", "assetCode", "quoteValue"].includes(key))
  ) {
    throw new TypeError("Execution-fill commission contains unsupported fields")
  }
  if (!isCanonicalDecimalString({ value: commission.amount })) {
    throw new TypeError("Execution-fill commission amount must be a non-negative exact decimal string")
  }
  requireNonEmptyString({ value: commission.assetId,
field: "commission.assetId",
maxLength: MAX_FACT_ID_LENGTH })
  requireNonEmptyString({ value: commission.assetCode,
field: "commission.assetCode",
maxLength: 32 })
  if (commission.quoteValue !== null) {
    const { quoteValue } = commission
    if (
      !quoteValue ||
      typeof quoteValue !== "object" ||
      Array.isArray(quoteValue) ||
      Object.keys(quoteValue).some((key) => !["amount", "assetId", "assetCode"].includes(key)) ||
      !isCanonicalDecimalString({ value: quoteValue.amount }) ||
      quoteValue.assetId !== quoteAssetId
    ) {
      throw new TypeError("Execution-fill commission quote valuation must use the canonical quote asset")
    }
    requireNonEmptyString({ value: quoteValue.assetCode,
field: "commission.quoteValue.assetCode",
maxLength: 32 })
  }
}

function validateExecutionFillCommissions({ commissions, quoteAssetId }) {
  for (const commission of commissions) {
    validateExecutionFillCommissionEntry({ commission,
quoteAssetId })
  }
}

function validateExecutionFillFactFields({ canonicalData }) {
  const allowedFields = new Set([
    "fillId",
    "tradeId",
    "brokerOrderId",
    "clientOrderId",
    "providerInstanceId",
    "providerType",
    "accountId",
    "marketId",
    "venue",
    "symbol",
    "baseAssetId",
    "quoteAssetId",
    "side",
    "price",
    "quantity",
    "quoteQuantity",
    "liquidityRole",
    "executedAt",
    "commissionStatus",
    "commissions",
  ])
  if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
    throw new TypeError("Execution-fill fact contains unsupported fields")
  }
}

function validateExecutionFillIdentityFields({ canonicalData }) {
  const providerFields = ["providerInstanceId", "providerType", "accountId"]
  const providerValues = providerFields.map((field) => canonicalData[field])
  if (providerValues.some((value) => value !== undefined) && providerValues.some((value) =>
    typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  )) {
    throw new TypeError("Execution-fill provider provenance must contain all three stable identifiers")
  }
  if (providerValues.some((value) => value !== undefined) && canonicalData.clientOrderId == null) {
    throw new TypeError("Provider-attributed execution fill requires its original clientOrderId")
  }
  const fillId = requireNonEmptyString({ value: canonicalData.fillId,
    field: "data.fillId",
    maxLength: MAX_FACT_ID_LENGTH })
  const tradeId = requireNonEmptyString({ value: canonicalData.tradeId,
    field: "data.tradeId",
    maxLength: MAX_FACT_ID_LENGTH })
  requireNonEmptyString({ value: canonicalData.brokerOrderId,
    field: "data.brokerOrderId",
    maxLength: MAX_FACT_ID_LENGTH })
  if (canonicalData.clientOrderId !== null) {
    requireNonEmptyString({
      value: canonicalData.clientOrderId,
      field: "data.clientOrderId",
      maxLength: MAX_FACT_ID_LENGTH,
    })
  }
  const marketId = requireNonEmptyString({ value: canonicalData.marketId,
    field: "data.marketId",
    maxLength: MAX_FACT_ID_LENGTH })
  const venue = requireNonEmptyString({ value: canonicalData.venue,
    field: "data.venue",
    maxLength: 32 })
  requireNonEmptyString({ value: canonicalData.baseAssetId,
    field: "data.baseAssetId",
    maxLength: MAX_FACT_ID_LENGTH })
  requireNonEmptyString({ value: canonicalData.quoteAssetId,
    field: "data.quoteAssetId",
    maxLength: MAX_FACT_ID_LENGTH })
  return { fillId,
    tradeId,
    marketId,
    venue }
}

function validateExecutionFillTimestamp({ canonicalData }) {
  if (
    canonicalData.executedAt !== null &&
    (!Number.isSafeInteger(canonicalData.executedAt) || canonicalData.executedAt < 0)
  ) {
    throw new TypeError("Execution-fill executedAt must be a non-negative safe integer or null")
  }
}

export function validateExecutionFillAppliedFact({ factType, canonicalData, factId }) {
  if (factType !== "EXECUTION_FILL_APPLIED") {
    return
  }
  validateExecutionFillFactFields({ canonicalData })
  const { fillId, tradeId, marketId, venue } = validateExecutionFillIdentityFields({ canonicalData })
  validateExecutionFillIdentity({ canonicalData,
    factId,
    fillId,
    tradeId,
    marketId,
    venue })
  validateExecutionFillSideAndLiquidity({ canonicalData })
  validateExecutionFillAmounts({ canonicalData })
  validateExecutionFillTimestamp({ canonicalData })
  validateExecutionFillCommissionStatus({ canonicalData })
  validateExecutionFillCommissions({
    commissions: canonicalData.commissions,
    quoteAssetId: canonicalData.quoteAssetId,
  })
}
