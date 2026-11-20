import { requireNonEmptyString, sha256OperationalStateValue } from "../operational-state-canonical.js"
import { MAX_FACT_ID_LENGTH } from "./operational-state-fact-schema.js"

const TERMINAL_STATUSES = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED"])

function createReconciliationFactId({ marketId, cycleId, sellOrderClientId, sellOrderBrokerOrderId }) {
  const identity = JSON.stringify([
    marketId,
    cycleId,
    sellOrderClientId,
    sellOrderBrokerOrderId,
  ])
  return `recovery-seller-mixed-sell-reconciled:${sha256OperationalStateValue(identity)}`
}

function validateIdentity({ canonicalData, factId }) {
  const marketId = requireNonEmptyString({
    value: canonicalData.marketId,
    field: "data.marketId",
    maxLength: MAX_FACT_ID_LENGTH,
  })
  const cycleId = requireNonEmptyString({
    value: canonicalData.cycleId,
    field: "data.cycleId",
    maxLength: 128,
  })
  const venue = requireNonEmptyString({
    value: canonicalData.venue,
    field: "data.venue",
    maxLength: 32,
  })
  const symbol = requireNonEmptyString({
    value: canonicalData.symbol,
    field: "data.symbol",
    maxLength: 30,
  })
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
  if (
    venue !== venue.toLowerCase() ||
    !/^[A-Z0-9]{3,30}$/.test(symbol) ||
    marketId !== `${venue}:${symbol}` ||
    canonicalData.baseAssetId === canonicalData.quoteAssetId ||
    factId !== createReconciliationFactId({
      marketId,
      cycleId,
      sellOrderClientId,
      sellOrderBrokerOrderId,
    })
  ) {
    throw new TypeError("Recovery Seller mixed-SELL reconciliation identity is not canonical")
  }
  return {
    marketId,
    cycleId,
    sellOrderClientId,
    sellOrderBrokerOrderId,
  }
}

function validateAppliedFillIds({ appliedFillIds }) {
  if (
    !Array.isArray(appliedFillIds) ||
    appliedFillIds.length === 0 ||
    appliedFillIds.some((fillId) => typeof fillId !== "string" || !fillId.trim() || fillId.length > MAX_FACT_ID_LENGTH) ||
    new Set(appliedFillIds).size !== appliedFillIds.length
  ) {
    throw new TypeError("Recovery Seller mixed-SELL reconciliation requires unique canonical applied fill identities")
  }
}

export function validateRecoverySellerMixedSellReconciledFact({ factType, canonicalData, factId }) {
  if (factType !== "RECOVERY_SELLER_MIXED_SELL_RECONCILED") {
    return
  }
  const allowedFields = new Set([
    "cycleId",
    "marketId",
    "venue",
    "symbol",
    "baseAssetId",
    "quoteAssetId",
    "sellOrderClientId",
    "sellOrderBrokerOrderId",
    "terminalStatus",
    "appliedFillIds",
    "accountingApplied",
    "eligible",
  ])
  if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
    throw new TypeError("Recovery Seller mixed-SELL reconciliation fact contains unsupported fields")
  }
  validateIdentity({ canonicalData, factId })
  validateAppliedFillIds({ appliedFillIds: canonicalData.appliedFillIds })
  if (
    !TERMINAL_STATUSES.has(canonicalData.terminalStatus) ||
    canonicalData.accountingApplied !== true ||
    typeof canonicalData.eligible !== "boolean"
  ) {
    throw new TypeError("Recovery Seller mixed-SELL reconciliation requires a terminal order, committed accounting and an explicit eligibility result")
  }
}
