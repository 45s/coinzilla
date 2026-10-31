import { toResult } from "@coinzilla/utils"
import { addDecimal, compareDecimal } from "./helpers/decimal.js"
import { calculateFillAccountingExact } from "./helpers/accounting.js"
import { reconcileExecutionFill } from "./fill-reconciliation.js"
import { buildGridOrderIndex, resolveGridOrderOwner } from "./grid-order-mapping.js"
import { projectGridCycles } from "./grid-cycles.js"

function failure(reason) {
  return toResult({ errors: [reason] })
}

function createEmptyReplayState({ state }) {
  return {
    ...state,
    ledgerEntries: Object.freeze([]),
    processedTradeIds: new Set(),
    fills: new Map(),
    fillsByOrder: new Map(),
    filledQuantityByOrder: new Map(),
    commissionTotals: new Map(),
    marketInventory: null,
    activeQuantity: "0",
    cycleCost: "0",
    saleProceeds: "0",
    freeQuantity: "0",
    actualCommissionRate: "0",
    feeRate: state.configuredFeeRate,
  }
}

// Rebuild all derived accounting from the durable canonical fill ledger.
// BUY fills are replayed before SELL fills because accounting is additive;
// per-cycle fill ownership is independently verified against the cycle
// snapshots before any SELL debit is applied.
export function replayGridFillLedger({ state, ledgerEntries } = {}) {
  if (!state || state.mode !== "grid" ||
      !(state.gridCycles instanceof Map) ||
      !Array.isArray(ledgerEntries)) {
    return failure("Grid fill replay requires a Grid pair state and a fill ledger")
  }

  const cycles = [...state.gridCycles.values()]
  const orderIndex = buildGridOrderIndex({
    cycles,
    pendingBuyOrder: state.buyOrder,
  })
  if (!orderIndex.ok) return orderIndex

  const ledgerById = new Map()
  for (const fill of ledgerEntries) {
    if (!fill || typeof fill !== "object" || Array.isArray(fill) ||
        typeof fill.id !== "string" || !fill.id.trim() ||
        ledgerById.has(fill.id)) {
      return failure("Grid fill ledger contains invalid or duplicate fill identities")
    }
    ledgerById.set(fill.id, fill)
  }

  for (const cycle of cycles) {
    for (const fillId of cycle.buyFillIds) {
      const fill = ledgerById.get(fillId)
      if (!fill || fill.orderId !== cycle.buyOrder.id || fill.side !== "BUY") {
        return failure(`Grid cycle ${cycle.id} is missing a canonical BUY fill`)
      }
    }
    for (const order of cycle.sellOrders) {
      for (const fillId of order.fillIds) {
        const fill = ledgerById.get(fillId)
        if (!fill || fill.orderId !== order.id || fill.side !== "SELL") {
          return failure(`Grid SELL order ${order.id} is missing a canonical fill`)
        }
      }
    }
  }

  const replayState = createEmptyReplayState({ state })
  const orderedFills = [
    ...ledgerEntries.filter((fill) => fill.side === "BUY"),
    ...ledgerEntries.filter((fill) => fill.side === "SELL"),
  ]

  for (const fill of orderedFills) {
    const ownerResult = resolveGridOrderOwner({
      orderIndex: orderIndex.data,
      orderId: fill.orderId,
      symbol: fill.symbol,
      side: fill.side,
    })
    if (!ownerResult.ok) return ownerResult
    const { owner } = ownerResult.data
    if (owner.role === "BUY" && owner.cycleId !== null) {
      const cycle = state.gridCycles.get(owner.cycleId)
      if (!cycle.buyFillIds.includes(fill.id)) {
        return failure(`Unexpected BUY fill ${fill.id} for completed Grid cycle ${cycle.id}`)
      }
    } else if (owner.role === "SELL") {
      const cycle = state.gridCycles.get(owner.cycleId)
      const order = cycle.sellOrders.find((entry) => entry.id === owner.orderId)
      if (!order?.fillIds.includes(fill.id)) {
        return failure(`Unexpected SELL fill ${fill.id} for Grid cycle ${cycle.id}`)
      }
    }

    const result = reconcileExecutionFill({
      fill,
      state: replayState,
    })
    if (!result.ok) return result
    Object.assign(replayState, result.updates)
  }

  if (state.buyOrder === null && orderedFills.some((fill) =>
    orderIndex.data.byOrderId[fill.orderId]?.cycleId === null,
  )) {
    return failure("Grid fill ledger contains a pending BUY fill without a tracked BUY order")
  }

  return toResult({ data: replayState })
}

// Derive pair-level active/free/recovery values from cycles plus any partial
// fills on the one currently working BUY order. Verify that this projection
// exactly reconciles to the strategy-owned base inventory ledger.
export function projectGridPairAccounting({ state } = {}) {
  if (!state || state.mode !== "grid" ||
      !(state.gridCycles instanceof Map) ||
      !(state.fills instanceof Map)) {
    return failure("Grid pair accounting requires initialized Grid state")
  }

  const projection = projectGridCycles({
    cycles: [...state.gridCycles.values()],
  })
  if (!projection.ok) return projection

  let pendingBuyQuantity = "0"
  let pendingBuyCost = "0"
  if (state.buyOrder) {
    for (const fill of state.fills.values()) {
      if (fill.orderId !== state.buyOrder.id || fill.side !== "BUY") continue
      const accounting = calculateFillAccountingExact({
        side: fill.side,
        quantity: fill.quantity,
        quoteQuantity: fill.quoteQuantity,
        commissionAmount: fill.commissionAmount,
        commissionAsset: fill.commissionAsset,
        baseAsset: state.baseAsset,
        quoteAsset: state.quoteAsset,
      })
      pendingBuyQuantity = addDecimal({
        left: pendingBuyQuantity,
        right: accounting.baseQuantity,
      })
      pendingBuyCost = addDecimal({
        left: pendingBuyCost,
        right: accounting.quoteQuantity,
      })
    }
  }

  const activeQuantity = addDecimal({
    left: projection.data.activeQuantity,
    right: pendingBuyQuantity,
  })
  const totalOwnedQuantity = addDecimal({
    left: activeQuantity,
    right: projection.data.freeQuantity,
  })
  const ledgerQuantity = state.marketInventory?.strategy?.baseQuantity ?? "0"
  if (compareDecimal({ left: totalOwnedQuantity, right: ledgerQuantity }) !== 0) {
    return failure("Grid active/free inventory does not reconcile to the market inventory ledger")
  }

  const sellFills = [...state.gridCycles.values()].reduce(
    (total, cycle) => total + cycle.sellOrders.filter((order) => order.status === "FILLED").length,
    0,
  )

  return toResult({
    data: {
      ...state,
      activeQuantity,
      cycleCost: addDecimal({
        left: projection.data.recoveryCost,
        right: pendingBuyCost,
      }),
      saleProceeds: projection.data.saleProceeds,
      freeQuantity: projection.data.freeQuantity,
      estimatedRealizedProfit: projection.data.realizedProfit,
      profitableCycles: projection.data.completedCycles,
      buyFills: state.gridCycles.size,
      sellFills,
      reservedQuantity: projection.data.reservedQuantity,
    },
  })
}
