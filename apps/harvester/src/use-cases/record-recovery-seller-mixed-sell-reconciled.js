import { createHash } from "node:crypto"
import { CanonicalOrder, Fill } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"
import { StrategyId } from "../domain/strategies/strategy-ids.js"

const TERMINAL_ORDER_STATUSES = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED"])

function createFactId({ marketId, cycleId, sellOrderClientId, sellOrderBrokerOrderId }) {
  const identity = JSON.stringify([
    marketId,
    cycleId,
    sellOrderClientId,
    sellOrderBrokerOrderId,
  ])
  const digest = createHash("sha256").update(identity).digest("hex")
  return `recovery-seller-mixed-sell-reconciled:${digest}`
}

function validateReconciliationInput({
  operationalStateStore,
  terminalOrder,
  ownership,
  canonicalFills,
  accountingApplied,
  eligible,
}) {
  if (typeof operationalStateStore?.append !== "function") {
    throw new TypeError("Recovery Seller mixed-SELL reconciliation requires durable Operational State Store append")
  }
  if (!(terminalOrder instanceof CanonicalOrder) ||
      !TERMINAL_ORDER_STATUSES.has(terminalOrder.status) ||
      typeof terminalOrder.brokerOrderId !== "string" ||
      !terminalOrder.brokerOrderId.trim()) {
    throw new TypeError("Recovery Seller mixed-SELL reconciliation requires an acknowledged terminal CanonicalOrder")
  }
  if (
    ownership?.strategyId !== StrategyId.RECOVERY_SELLER ||
    ownership.purpose !== "RECOVERY_SELL" ||
    typeof ownership.cycleId !== "string" || !ownership.cycleId.trim() ||
    typeof ownership.positionId !== "string" || !ownership.positionId.trim()
  ) {
    throw new TypeError("Recovery Seller mixed-SELL reconciliation requires immutable cycle and Position ownership")
  }
  if (accountingApplied !== true || typeof eligible !== "boolean") {
    throw new TypeError("Recovery Seller mixed-SELL reconciliation requires a committed accounting result and explicit eligibility")
  }
  if (!Array.isArray(canonicalFills) || canonicalFills.length === 0) {
    throw new TypeError("Recovery Seller mixed-SELL reconciliation requires the complete canonical terminal fill set")
  }
  const fillIds = new Set()
  for (const fill of canonicalFills) {
    if (!(fill instanceof Fill) ||
        fill.side !== "SELL" ||
        fill.market.id !== terminalOrder.market.id ||
        fill.clientOrderId !== terminalOrder.clientOrderId ||
        fill.brokerOrderId !== terminalOrder.brokerOrderId ||
        fillIds.has(fill.id)) {
      throw new TypeError("Recovery Seller mixed-SELL reconciliation contains missing, duplicate or foreign canonical fills")
    }
    fillIds.add(fill.id)
  }
  return Object.freeze([...fillIds])
}

/**
 * Commit the durable boundary after terminal mixed-SELL accounting has applied
 * both the shared Portfolio and legacy projections. A terminal order status or
 * a fill fact by itself is never sufficient to release the cycle reservation.
 */
export async function recordRecoverySellerMixedSellReconciled(options = {}) {
  try {
    const {
      operationalStateStore,
      terminalOrder,
      ownership,
      canonicalFills,
      accountingApplied,
      eligible,
    } = options
    const appliedFillIds = validateReconciliationInput(options)
    const { market } = terminalOrder
    const factId = createFactId({
      marketId: market.id,
      cycleId: ownership.cycleId,
      sellOrderClientId: terminalOrder.clientOrderId,
      sellOrderBrokerOrderId: terminalOrder.brokerOrderId,
    })
    const result = await operationalStateStore.append({
      factId,
      factType: "RECOVERY_SELLER_MIXED_SELL_RECONCILED",
      data: {
        cycleId: ownership.cycleId,
        marketId: market.id,
        venue: market.venue,
        symbol: market.symbol,
        baseAssetId: market.baseAsset.id,
        quoteAssetId: market.quoteAsset.id,
        sellOrderClientId: terminalOrder.clientOrderId,
        sellOrderBrokerOrderId: terminalOrder.brokerOrderId,
        terminalStatus: terminalOrder.status,
        appliedFillIds,
        accountingApplied: true,
        eligible,
      },
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return toResult({
        errors: result?.errors?.length
          ? result.errors
          : [new Error("Recovery Seller mixed-SELL reconciliation fact append was not durably confirmed")],
      })
    }
    return result
  } catch (error) {
    return toResult({ error })
  }
}
