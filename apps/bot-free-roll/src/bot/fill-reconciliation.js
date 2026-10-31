import { Fill } from "@coinzilla/entities"
import { appendFillLedgerEntry } from "./fill-ledger.js"
import {
  addDecimal,
  assertDecimalString,
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

  const ledger = appendFillLedgerEntry({
    entries: state.ledgerEntries ?? [],
    fill,
  })
  if (!ledger.ok) {
    return failure({ reason: ledger.reason })
  }

  const wasProcessed = state.processedTradeIds.has(fillId)
  if (wasProcessed) {
    if (!ledger.duplicate) {
      return failure({
        reason: `Processed trade ${fillId} is missing from the immutable fill ledger`,
      })
    }
    return { ok: true, duplicate: true }
  }
  if (ledger.duplicate) {
    return failure({
      reason: `Fill ledger contains unprocessed trade ${fillId}`,
    })
  }

  const recordedFill = ledger.entry
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
    ledgerEntries: ledger.entries,
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

// Compare the local execution ledger with the exchange's complete history for
// one tracked order. Exchange-only fills are returned for idempotent backfill;
// local-only or changed fills are unrecoverable discrepancies and fail closed.
export function reconcileFillHistory({
  localFills,
  canonicalFills,
  symbol,
  order,
} = {}) {
  if (!Array.isArray(localFills) || !Array.isArray(canonicalFills) ||
      typeof symbol !== "string" || !symbol ||
      !order || typeof order.id !== "string" || !order.id) {
    return { ok: false, reason: "Fill history reconciliation input is incomplete" }
  }

  const localById = new Map()
  for (const fill of localFills) {
    const fillId = typeof fill?.id === "string" ? fill.id : ""
    const validation = validateOrderFill({ fill, symbol, order })
    if (!fillId || !validation.ok || localById.has(fillId)) {
      return {
        ok: false,
        reason: `Local fill history for order ${order.id} contains an invalid or duplicate fill`,
      }
    }
    localById.set(fillId, fill)
  }

  const exchangeById = new Map()
  for (const canonicalFill of canonicalFills) {
    const execution = toExecutionFill({ fill: canonicalFill })
    if (!execution.ok) {
      return { ok: false, reason: execution.reason }
    }

    const fill = execution.fill
    const fillId = fill.id
    const validation = validateOrderFill({ fill, symbol, order })
    if (!fillId || !validation.ok || exchangeById.has(fillId)) {
      return {
        ok: false,
        reason: `Exchange fill history for order ${order.id} contains an invalid or duplicate fill`,
      }
    }
    exchangeById.set(fillId, { canonicalFill, fill })
  }

  for (const [fillId, localFill] of localById) {
    const exchangeRecord = exchangeById.get(fillId)
    if (!exchangeRecord) {
      return {
        ok: false,
        reason: `Local fill ${fillId} for order ${order.id} is missing from exchange history`,
      }
    }

    const exchangeFill = exchangeRecord.fill
    const identityMatches =
      localFill.orderId === exchangeFill.orderId &&
      localFill.symbol === exchangeFill.symbol &&
      localFill.side === exchangeFill.side &&
      localFill.isMaker === exchangeFill.isMaker
    if (!identityMatches) {
      return {
        ok: false,
        reason: `Local fill ${fillId} identity differs from exchange history`,
      }
    }

    try {
      for (const field of ["price", "quantity", "quoteQuantity", "commissionAmount"]) {
        if (
          typeof localFill[field] !== "string" ||
          typeof exchangeFill[field] !== "string" ||
          compareDecimal({ left: localFill[field], right: exchangeFill[field] }) !== 0
        ) {
          return {
            ok: false,
            reason: `Local fill ${fillId} ${field} differs from exchange history`,
          }
        }
      }

      const localCommissionAsset = compareDecimal({
        left: localFill.commissionAmount,
        right: "0",
      }) > 0
        ? localFill.commissionAsset
        : null
      if (localCommissionAsset !== exchangeFill.commissionAsset) {
        return {
          ok: false,
          reason: `Local fill ${fillId} commission asset differs from exchange history`,
        }
      }
    } catch (error) {
      return {
        ok: false,
        reason: `Local fill ${fillId} contains invalid exact values: ${error.message}`,
      }
    }
  }

  const missingFills = [...exchangeById]
    .filter(([fillId]) => !localById.has(fillId))
    .map(([, record]) => record.canonicalFill)

  return {
    ok: true,
    missingFills: Object.freeze(missingFills),
  }
}


// Rebuild the execution-derived projection for one accounting window. Cycle
// completion and inventory-bucket events are deliberately not inferred from
// fills; those belong to the broader inventory ledger stages.
export function replayExecutionFills({ entries, pairState } = {}) {
  if (!Array.isArray(entries)) {
    return { ok: false, reason: "Execution fill ledger entries must be an array" }
  }
  if (
    !pairState ||
    typeof pairState !== "object" ||
    Array.isArray(pairState) ||
    !["LIMIT", "LIMIT_MAKER"].includes(pairState.orderType) ||
    typeof pairState.baseAsset !== "string" ||
    !pairState.baseAsset ||
    typeof pairState.quoteAsset !== "string" ||
    !pairState.quoteAsset ||
    typeof pairState.configuredFeeRate !== "string"
  ) {
    return { ok: false, reason: "Execution fill replay requires valid pair accounting settings" }
  }

  try {
    assertDecimalString(pairState.configuredFeeRate, "configuredFeeRate")
  } catch (error) {
    return {
      ok: false,
      reason: `Execution fill replay has an invalid configured fee rate: ${error.message}`,
    }
  }

  const state = {
    orderType: pairState.orderType,
    baseAsset: pairState.baseAsset,
    quoteAsset: pairState.quoteAsset,
    configuredFeeRate: pairState.configuredFeeRate,
    feeRate: pairState.configuredFeeRate,
    actualCommissionRate: "0",
    activeQuantity: "0",
    cycleCost: "0",
    saleProceeds: "0",
    processedTradeIds: new Set(),
    fills: new Map(),
    fillsByOrder: new Map(),
    filledQuantityByOrder: new Map(),
    commissionTotals: new Map(),
    ledgerEntries: Object.freeze([]),
  }

  for (const fill of entries) {
    const result = reconcileExecutionFill({ fill, state })
    if (result.updates) Object.assign(state, result.updates)
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        failedFillId: fill?.id ?? null,
        state,
      }
    }
  }

  return { ok: true, state }
}
