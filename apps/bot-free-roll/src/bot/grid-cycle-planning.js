import { toResult } from "@coinzilla/utils"
import { calculateFillAccountingExact } from "./helpers/accounting.js"
import { calculateSellPlanExact } from "./helpers/order-planning.js"
import { addDecimal, compareDecimal } from "./helpers/decimal.js"
import { createGridCycle, projectGridCycles } from "./grid-cycles.js"

function failure(reason) {
  return toResult({ errors: [reason] })
}

// Convert the canonical, complete BUY fill history for exactly one order into
// its immutable cycle. Actual fill accounting, not requested order values,
// determines acquired base quantity and recovery cost.
export function createGridCycleFromBuyFills({
  symbol,
  baseAsset,
  quoteAsset,
  buyOrderId,
  buyFills,
} = {}) {
  if (!Array.isArray(buyFills) || buyFills.length === 0) {
    return failure("buyFills must contain at least one canonical fill")
  }

  const seenIds = new Set()
  let acquiredQuantity = "0"
  let recoveryCost = "0"
  const commissionTotals = {}

  try {
    for (const fill of buyFills) {
      if (!fill || typeof fill !== "object" || Array.isArray(fill) ||
          typeof fill.id !== "string" || !fill.id.trim() ||
          String(fill.orderId) !== buyOrderId ||
          fill.symbol !== symbol ||
          fill.side !== "BUY") {
        throw new Error("BUY fill identity does not match the cycle order and market")
      }
      if (seenIds.has(fill.id)) throw new Error(`duplicate BUY trade ID ${fill.id}`)
      seenIds.add(fill.id)

      const commissionAmount = String(fill.commissionAmount ?? "")
      const accounting = calculateFillAccountingExact({
        side: fill.side,
        quantity: String(fill.quantity ?? ""),
        quoteQuantity: String(fill.quoteQuantity ?? ""),
        commissionAmount,
        commissionAsset: fill.commissionAsset ?? null,
        baseAsset,
        quoteAsset,
      })
      acquiredQuantity = addDecimal({
        left: acquiredQuantity,
        right: accounting.baseQuantity,
      })
      recoveryCost = addDecimal({
        left: recoveryCost,
        right: accounting.quoteQuantity,
      })

      if (compareDecimal({ left: commissionAmount, right: "0" }) > 0) {
        const asset = fill.commissionAsset
        commissionTotals[asset] = addDecimal({
          left: commissionTotals[asset] ?? "0",
          right: commissionAmount,
        })
      }
    }

    return createGridCycle({
      symbol,
      baseAsset,
      quoteAsset,
      buyOrderId,
      buyFillIds: [...seenIds],
      acquiredQuantity,
      recoveryCost,
      buyCommissionTotals: commissionTotals,
    })
  } catch (error) {
    return failure(error.message)
  }
}

// Calculate one cycle's recovery SELL plan. Existing live SELL orders must be
// reconciled/closed before a replacement plan can be created.
export function calculateGridCycleSellPlan({
  cycle,
  keepQuantity,
  minProfit,
  feeRate,
  priceTickSize,
  quantityStepSize,
} = {}) {
  const validation = projectGridCycles({ cycles: [cycle] })
  if (!validation.ok) return validation
  if (cycle.status !== "OPEN") return failure("completed cycles cannot receive SELL plans")
  if (cycle.currentSellOrderId !== null) {
    return failure("cycle already has a live SELL order")
  }

  try {
    const plan = calculateSellPlanExact({
      activeQuantity: cycle.remainingQuantity,
      keepQuantity,
      cycleCost: cycle.recoveryCost,
      saleProceeds: cycle.saleProceeds,
      minProfit,
      feeRate,
      priceTickSize,
      quantityStepSize,
    })
    return toResult({ data: plan })
  } catch (error) {
    return failure(error.message)
  }
}
