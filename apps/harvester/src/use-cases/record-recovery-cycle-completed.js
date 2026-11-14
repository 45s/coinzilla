import { createHash } from "node:crypto"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { Position } from "../domain/portfolio/position.js"
import { assertTerminalRecoverySellOrder } from "../domain/orders/assert-terminal-recovery-sell-order.js"
import { compareDecimal, toResult } from "@coinzilla/utils"

/** Persist an eligible recovery-cycle boundary before Portfolio/RecoveryLedger reset is committed. */
export async function recordRecoveryCycleCompleted({
  operationalStateStore,
  recoveryLedger,
  position,
  sellOrder,
  completion,
  minProfit,
} = {}) {
  try {
    if (typeof operationalStateStore?.append !== "function") { throw new TypeError("recordRecoveryCycleCompleted requires a Operational State Store append capability") }
    if (!(recoveryLedger instanceof RecoveryLedger) || !(position instanceof Position)) {
      throw new TypeError("recordRecoveryCycleCompleted requires canonical RecoveryLedger and Position values")
    }
    assertTerminalRecoverySellOrder({ sellOrder })
    if (completion?.eligible !== true) { throw new TypeError("Only an eligible recovery cycle can be durably completed") }
    const market = recoveryLedger.market
    if (position.market.id !== market.id || sellOrder.market.id !== market.id) {
      throw new TypeError("Recovery-cycle Position, ledger, and terminal SELL markets must match")
    }
    if (compareDecimal({ left: position.spent.amount, right: recoveryLedger.buyCost }) !== 0) {
      throw new TypeError("Recovery-cycle authoritative Position.spent must match RecoveryLedger buyCost")
    }
    if (compareDecimal({ left: completion.realizedNetProfit, right: recoveryLedger.realizedNetProfit }) !== 0 ||
        compareDecimal({ left: completion.realizedNetProfit, right: minProfit }) < 0) {
      throw new TypeError("Recovery-cycle completion profit must match the ledger and satisfy minProfit")
    }
    if (compareDecimal({ left: completion.activeQuantity, right: position.baseQuantity.amount }) !== 0 ||
        compareDecimal({ left: completion.freeQuantity, right: completion.activeQuantity }) !== 0 ||
        compareDecimal({ left: completion.minProfit, right: minProfit }) !== 0) {
      throw new TypeError("Recovery-cycle quantities and minProfit must match the canonical completion input")
    }
    const inventoryDisposition = completion.dust ?? null
    const appliedFillIds = [...recoveryLedger.appliedFillIds]
    if (appliedFillIds.length === 0) { throw new TypeError("Recovery-cycle completion requires at least one applied execution fill") }
    const canonicalInventoryDisposition = inventoryDisposition === null
      ? null
      : Object.fromEntries(Object.entries(inventoryDisposition).sort(([left], [right]) => left.localeCompare(right)))
    const cycleIdentity = JSON.stringify([
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
      completion.freeQuantity,
      canonicalInventoryDisposition,
    ])
    const cycleId = createHash("sha256").update(cycleIdentity).digest("hex")
    const result = await operationalStateStore.append({
      factId: "recovery-cycle-completed:" + market.id + ":" + cycleId,
      factType: "RECOVERY_CYCLE_COMPLETED",
      data: {
        cycleId,
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
        freeQuantity: completion.freeQuantity,
        inventoryDisposition,
      },
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return toResult({ errors: result?.errors?.length ? result.errors : [new Error("Recovery-cycle completion append did not confirm durable commitment")] })
    }
    return result
  } catch (error) {
    return toResult({ error })
  }
}
