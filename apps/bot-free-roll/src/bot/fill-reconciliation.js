import { Fill } from "@coinzilla/entities"
import {
  addDecimal,
  compareDecimal,
  maxDecimal,
  subtractDecimal,
} from "./helpers/decimal.js"
import {
  calculateCommissionRateExact,
  calculateFillAccountingExact,
} from "./helpers/accounting.js"

function failure({ reason, updates, recordedFill, error }) {
  return {
    ok: false,
    duplicate: false,
    updates,
    recordedFill,
    reason,
    error,
  }
}


export function toExecutionFill({ fill } = {}) {
  if (!(fill instanceof Fill)) {
    return { ok: false, reason: "Recovered execution must be a canonical Fill" }
  }
  if (fill.commissionStatus !== "COMPLETE") {
    return { ok: false, reason: `Commission data is ${fill.commissionStatus.toLowerCase()} for trade ${fill.tradeId}` }
  }
  if (fill.liquidityRole !== "MAKER" && fill.liquidityRole !== "TAKER") {
    return { ok: false, reason: `Liquidity role is unknown for trade ${fill.tradeId}` }
  }
  if (fill.commissions.length > 1) {
    return { ok: false, reason: `Multiple commission assets are not supported for trade ${fill.tradeId}` }
  }

  const commission = fill.commissions[0]
  const commissionAmount = commission?.amount.amount ?? "0"
  const commissionAsset = compareDecimal({ left: commissionAmount, right: "0" }) > 0
    ? commission.amount.asset.code
    : null

  return {
    ok: true,
    fill: {
      id: fill.tradeId,
      orderId: fill.brokerOrderId,
      symbol: fill.market.symbol,
      side: fill.side,
      price: fill.price.amount,
      quantity: fill.quantity.amount,
      quoteQuantity: fill.quoteQuantity.amount,
      commissionAmount,
      commissionAsset,
      isMaker: fill.liquidityRole === "MAKER",
    },
  }
}

// Pure transition: calculate the exact state changes for one canonical fill.
// The caller owns applying updates and publishing events / pause notifications.
export function reconcileExecutionFill({ fill, state }) {
  if (!state || !fill || typeof fill !== "object") {
    return {
      ok: false,
      duplicate: false,
      reason: "Execution fill or pair state is missing",
    }
  }

  const fillId = String(fill.id ?? "")
  const orderId = String(fill.orderId ?? "")
  if (
    !fillId ||
    fillId === "-1" ||
    fillId === "undefined" ||
    !orderId ||
    orderId === "undefined"
  ) {
    return failure({
      reason: "Execution fill is missing a stable trade or order ID",
    })
  }

  if (state.processedTradeIds.has(fillId)) {
    return { ok: true, duplicate: true }
  }

  const recordedFill = { ...fill }
  const processedTradeIds = new Set(state.processedTradeIds)
  processedTradeIds.add(fillId)
  const fills = new Map(state.fills)
  fills.set(fillId, recordedFill)
  const fillsByOrder = new Map(state.fillsByOrder)
  fillsByOrder.set(orderId, (fillsByOrder.get(orderId) ?? 0) + 1)
  const commissionTotals = new Map(state.commissionTotals)

  const commissionAmount = String(fill.commissionAmount ?? "")
  const commissionAsset = fill.commissionAsset ?? null
  if (commissionAmount && compareDecimal({ left: commissionAmount, right: "0" }) > 0) {
    const asset = commissionAsset ?? "UNKNOWN"
    commissionTotals.set(
      asset,
      addDecimal({
        left: commissionTotals.get(asset) ?? "0",
        right: commissionAmount,
      }),
    )
  }

  const updates = {
    processedTradeIds,
    fills,
    fillsByOrder,
    commissionTotals,
  }

  if (fill.side !== "BUY" && fill.side !== "SELL") {
    return failure({
      reason: `Unsupported fill side for trade ${fillId}`,
      updates,
      recordedFill,
    })
  }

  if (typeof fill.isMaker !== "boolean") {
    return failure({
      reason: `Execution fill ${fillId} is missing its maker/taker classification`,
      updates,
      recordedFill,
    })
  }
  if (state.orderType === "LIMIT_MAKER" && !fill.isMaker) {
    return failure({
      reason: `LIMIT_MAKER order produced a taker fill for trade ${fillId}`,
      updates,
      recordedFill,
    })
  }

  let accounting
  let actualCommissionRate
  try {
    accounting = calculateFillAccountingExact({
      side: fill.side,
      quantity: String(fill.quantity ?? ""),
      quoteQuantity: String(fill.quoteQuantity ?? ""),
      commissionAmount,
      commissionAsset,
      baseAsset: state.baseAsset,
      quoteAsset: state.quoteAsset,
    })
    actualCommissionRate = calculateCommissionRateExact({
      price: String(fill.price ?? ""),
      quoteQuantity: String(fill.quoteQuantity ?? ""),
      commissionAmount,
      commissionAsset,
      baseAsset: state.baseAsset,
      quoteAsset: state.quoteAsset,
    })
  } catch (error) {
    return failure({
      reason: `Unsupported or incomplete commission/fill data for trade ${fillId}`,
      updates,
      recordedFill,
      error,
    })
  }

  if (
    fill.side === "SELL" &&
    compareDecimal({ left: state.activeQuantity, right: accounting.baseQuantity }) < 0
  ) {
    return failure({
      reason: `SELL fill ${fillId} consumes more base inventory than the strategy owns`,
      updates,
      recordedFill,
    })
  }

  updates.actualCommissionRate = maxDecimal({
    left: state.actualCommissionRate,
    right: actualCommissionRate,
  })
  updates.feeRate = maxDecimal({
    left: state.configuredFeeRate,
    right: updates.actualCommissionRate,
  })

  if (fill.side === "BUY") {
    updates.activeQuantity = addDecimal({
      left: state.activeQuantity,
      right: accounting.baseQuantity,
    })
    updates.cycleCost = addDecimal({
      left: state.cycleCost,
      right: accounting.quoteQuantity,
    })
  } else {
    updates.activeQuantity = subtractDecimal({
      left: state.activeQuantity,
      right: accounting.baseQuantity,
    })
    updates.saleProceeds = addDecimal({
      left: state.saleProceeds,
      right: accounting.quoteQuantity,
    })
  }

  const filledQuantityByOrder = new Map(state.filledQuantityByOrder)
  filledQuantityByOrder.set(
    orderId,
    addDecimal({
      left: filledQuantityByOrder.get(orderId) ?? "0",
      right: String(fill.quantity),
    }),
  )
  updates.filledQuantityByOrder = filledQuantityByOrder

  return {
    ok: true,
    duplicate: false,
    updates,
    recordedFill,
    accounting,
  }
}

// Validate one history record before the orchestrator applies it.
export function validateOrderFill({ fill, symbol, order }) {
  if (
    String(fill?.orderId) !== String(order.id) ||
    fill?.symbol !== symbol ||
    fill?.side !== order.side
  ) {
    return {
      ok: false,
      reason: `Trade history returned a fill outside order ${order.id}`,
    }
  }

  return { ok: true }
}
