import { createHash } from "node:crypto"
import { compareDecimal, toResult } from "@coinzilla/utils"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { Position } from "../domain/portfolio/position.js"
import { assertTerminalRecoverySellOrder } from "../domain/orders/assert-terminal-recovery-sell-order.js"

const CONTINUE_REASONS = new Set([
  "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
  "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY",
])

/** Persist the explicit non-completion outcome for a reconciled full recovery SELL. */
export async function recordRecoveryCycleNotCompleted({
  operationalStateStore,
  recoveryLedger,
  position,
  sellOrder,
  completion,
  minProfit,
} = {}) {
  try {
    if (typeof operationalStateStore?.append !== "function") {
      throw new TypeError("recordRecoveryCycleNotCompleted requires a Operational State Store append capability")
    }
    if (!(recoveryLedger instanceof RecoveryLedger) || !(position instanceof Position)) {
      throw new TypeError("recordRecoveryCycleNotCompleted requires canonical RecoveryLedger and Position values")
    }
    assertTerminalRecoverySellOrder({ sellOrder })
    if (completion?.eligible !== false || typeof completion.pause !== "boolean" ||
        typeof completion.reason !== "string" || completion.reason.trim() === "") {
      throw new TypeError("Recovery-cycle non-completion requires a complete ineligible evaluation")
    }
    const market = recoveryLedger.market
    if (position.market.id !== market.id || sellOrder.market.id !== market.id) {
      throw new TypeError("Recovery-cycle Position, ledger, and terminal SELL markets must match")
    }
    if (compareDecimal({ left: position.spent.amount, right: recoveryLedger.buyCost }) !== 0 ||
        compareDecimal({ left: completion.realizedNetProfit, right: recoveryLedger.realizedNetProfit }) !== 0 ||
        compareDecimal({ left: completion.activeQuantity, right: position.baseQuantity.amount }) !== 0 ||
        compareDecimal({ left: completion.minProfit, right: minProfit }) !== 0) {
      throw new TypeError("Recovery-cycle non-completion evidence must match canonical Position, RecoveryLedger, and minProfit")
    }
    const outcome = completion.pause === false && CONTINUE_REASONS.has(completion.reason)
      ? "CONTINUE_SELL_THROUGH"
      : "BLOCKED"
    if (outcome === "CONTINUE_SELL_THROUGH") {
      if (compareDecimal({ left: completion.activeQuantity, right: completion.keepQuantity }) <= 0) {
        throw new TypeError("CONTINUE_SELL_THROUGH requires residual active inventory above keepQuantity")
      }
      if (completion.reason === "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH" &&
          compareDecimal({ left: completion.realizedNetProfit, right: minProfit }) < 0) {
        throw new TypeError("Residual sell-through requires the minimum profit target to be met")
      }
      if (completion.reason === "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY" &&
          compareDecimal({ left: completion.realizedNetProfit, right: minProfit }) >= 0) {
        throw new TypeError("Profit-target continuation requires realized profit below minProfit")
      }
    } else if (CONTINUE_REASONS.has(completion.reason)) {
      throw new TypeError("A continue-sell-through reason cannot be recorded as BLOCKED")
    }
    const appliedFillIds = [...recoveryLedger.appliedFillIds]
    if (appliedFillIds.length === 0) {
      throw new TypeError("Recovery-cycle non-completion requires at least one applied execution fill")
    }
    const evaluationIdentity = JSON.stringify([
      market.id,
      sellOrder.clientOrderId,
      sellOrder.brokerOrderId,
      appliedFillIds,
      recoveryLedger.buyCost,
      position.spent.amount,
      recoveryLedger.netSellProceeds,
      completion.realizedNetProfit,
      minProfit,
      completion.activeQuantity,
      completion.keepQuantity,
      outcome,
      completion.reason,
    ])
    const evaluationId = createHash("sha256").update(evaluationIdentity).digest("hex")
    const result = await operationalStateStore.append({
      factId: "recovery-cycle-not-completed:" + market.id + ":" + evaluationId,
      factType: "RECOVERY_CYCLE_NOT_COMPLETED",
      data: {
        evaluationId,
        marketId: market.id,
        venue: market.venue,
        symbol: market.symbol,
        baseAssetId: market.baseAsset.id,
        quoteAssetId: market.quoteAsset.id,
        appliedFillIds,
        sellOrderClientId: sellOrder.clientOrderId,
        sellOrderBrokerOrderId: sellOrder.brokerOrderId,
        buyCost: recoveryLedger.buyCost,
        spent: position.spent.amount,
        netSellProceeds: recoveryLedger.netSellProceeds,
        realizedNetProfit: completion.realizedNetProfit,
        minProfit,
        activeQuantity: completion.activeQuantity,
        keepQuantity: completion.keepQuantity,
        outcome,
        reason: completion.reason,
      },
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return toResult({
        errors: result?.errors?.length
          ? result.errors
          : [new Error("Recovery-cycle non-completion append did not confirm durable commitment")],
      })
    }
    return result
  } catch (error) {
    return toResult({ error })
  }
}
