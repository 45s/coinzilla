import { toResult } from "@coinzilla/utils"
import { projectGridCycles } from "./grid-cycles.js"

function failure(reason) {
  return toResult({ errors: [reason] })
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function validateOrderSnapshot({ order, symbol, side }) {
  return Boolean(
    order &&
    typeof order === "object" &&
    !Array.isArray(order) &&
    isNonEmptyString(order.id) &&
    isNonEmptyString(order.clientOrderId) &&
    order.symbol === symbol &&
    order.side === side &&
    ["LIMIT", "LIMIT_MAKER"].includes(order.type) &&
    typeof order.quantity === "string" &&
    typeof order.price === "string",
  )
}

export function validateGridPairStateSnapshot({ snapshot, symbol, configFingerprint } = {}) {
  if (!isPlainObject(snapshot) || snapshot.mode !== "grid") {
    return failure("Grid pair snapshot must declare mode grid")
  }
  if (!isNonEmptyString(symbol) || snapshot.symbol !== symbol) {
    return failure("Grid pair snapshot symbol does not match its configured pair")
  }
  if (!isNonEmptyString(configFingerprint) ||
      snapshot.configFingerprint !== configFingerprint) {
    return failure("Grid pair snapshot configuration fingerprint does not match current settings")
  }
  if (!Array.isArray(snapshot.cycles) ||
      !Array.isArray(snapshot.orderIntents) ||
      !Array.isArray(snapshot.ledgerEntries)) {
    return failure("Grid pair snapshot cycles, orderIntents, and ledgerEntries must be arrays")
  }
  if (!Number.isSafeInteger(snapshot.nextIntentSequence) ||
      snapshot.nextIntentSequence < 0 ||
      typeof snapshot.trailingBuy !== "boolean" ||
      typeof snapshot.paused !== "boolean") {
    return failure("Grid pair snapshot runtime flags or intent sequence are invalid")
  }
  for (const field of ["referencePrice", "highestPrice", "lastAdjustmentPrice", "lastBuyPrice"]) {
    if (snapshot[field] !== null && typeof snapshot[field] !== "string" &&
        typeof snapshot[field] !== "number") {
      return failure(`Grid pair snapshot ${field} must be null, a string, or a number`)
    }
  }
  if (snapshot.buyOrder !== null &&
      !validateOrderSnapshot({ order: snapshot.buyOrder, symbol, side: "BUY" })) {
    return failure("Grid pair snapshot contains an invalid current BUY order")
  }

  const cycleProjection = projectGridCycles({ cycles: snapshot.cycles })
  if (!cycleProjection.ok) return cycleProjection
  if (snapshot.cycles.some((cycle) => cycle.symbol !== symbol)) {
    return failure("Grid pair snapshot contains a cycle for another symbol")
  }

  const cycleIds = new Set(snapshot.cycles.map((cycle) => cycle.id))
  const intentIds = new Set()
  let buyIntentCount = 0
  for (const intent of snapshot.orderIntents) {
    if (!isPlainObject(intent) ||
        !isNonEmptyString(intent.intentId) ||
        !isNonEmptyString(intent.clientOrderId) ||
        intent.symbol !== symbol ||
        !["BUY", "SELL"].includes(intent.side) ||
        !["LIMIT", "LIMIT_MAKER"].includes(intent.type) ||
        !["PREPARED", "ACKNOWLEDGED"].includes(intent.status) ||
        intentIds.has(intent.clientOrderId)) {
      return failure("Grid pair snapshot contains an invalid or duplicate order intent")
    }
    intentIds.add(intent.clientOrderId)
    if (intent.side === "BUY") {
      buyIntentCount += 1
      if (intent.cycleId !== null) {
        return failure("BUY order intent cannot belong to an existing cycle")
      }
    } else if (!cycleIds.has(intent.cycleId)) {
      return failure("SELL order intent references an unknown cycle")
    }
  }
  if (buyIntentCount > 1 || (snapshot.buyOrder && buyIntentCount > 0)) {
    return failure("Grid pair snapshot has conflicting BUY order state")
  }

  const ledgerFillIds = new Set()
  for (const entry of snapshot.ledgerEntries) {
    if (!isPlainObject(entry) ||
        !isNonEmptyString(entry.id) ||
        !isNonEmptyString(entry.orderId) ||
        entry.symbol !== symbol ||
        !["BUY", "SELL"].includes(entry.side) ||
        ledgerFillIds.has(entry.id)) {
      return failure("Grid pair snapshot contains invalid or duplicate fill ledger entries")
    }
    ledgerFillIds.add(entry.id)
  }

  return toResult({ data: snapshot })
}

// Convert the mutable runtime containers into a JSON-safe, immutable pair
// snapshot. Derived maps/sets and aggregate accounting are rebuilt from the
// immutable fill ledger during restore rather than persisted twice.
export function serializeGridPairState({ state, configFingerprint } = {}) {
  try {
    if (!state || state.mode !== "grid" ||
        !(state.gridCycles instanceof Map) ||
        !(state.orderIntents instanceof Map) ||
        !Array.isArray(state.ledgerEntries)) {
      throw new Error("Grid runtime state is incomplete")
    }
    const snapshot = Object.freeze({
      mode: "grid",
      symbol: state.symbol,
      configFingerprint,
      buyOrder: state.buyOrder ? Object.freeze({ ...state.buyOrder }) : null,
      cycles: Object.freeze([...state.gridCycles.values()]),
      orderIntents: Object.freeze([...state.orderIntents.values()]),
      ledgerEntries: Object.freeze([...state.ledgerEntries]),
      nextIntentSequence: state.nextIntentSequence,
      referencePrice: state.referencePrice === undefined ? null : state.referencePrice,
      highestPrice: state.highestPrice === undefined ? null : state.highestPrice,
      lastAdjustmentPrice: state.lastAdjustmentPrice === undefined ? null : state.lastAdjustmentPrice,
      lastBuyPrice: state.lastBuyPrice === undefined ? null : state.lastBuyPrice,
      trailingBuy: state.trailingBuy,
      paused: state.paused,
    })
    const validation = validateGridPairStateSnapshot({
      snapshot,
      symbol: state.symbol,
      configFingerprint,
    })
    if (!validation.ok) return validation
    return toResult({ data: snapshot })
  } catch (error) {
    return failure(error.message)
  }
}

// Restore only durable source-of-truth fields. The bot replays ledgerEntries
// through reconcileExecutionFill to rebuild all accounting maps and the market
// inventory ledger before it can reconcile or submit another order.
export function restoreGridPairState({ snapshot, state, configFingerprint } = {}) {
  const validation = validateGridPairStateSnapshot({
    snapshot,
    symbol: state?.symbol,
    configFingerprint,
  })
  if (!validation.ok) return validation
  if (!state || state.mode !== "grid") {
    return failure("Grid restore requires an initialized Grid pair state")
  }

  const trackedOrderIds = new Set()
  if (snapshot.buyOrder) trackedOrderIds.add(snapshot.buyOrder.id)
  for (const cycle of snapshot.cycles) {
    trackedOrderIds.add(cycle.buyOrder.id)
    for (const order of cycle.sellOrders) trackedOrderIds.add(order.id)
  }

  return toResult({
    data: {
      ...state,
      buyOrder: snapshot.buyOrder,
      sellOrder: null,
      gridCycles: new Map(snapshot.cycles.map((cycle) => [cycle.id, cycle])),
      orderIntents: new Map(snapshot.orderIntents.map((intent) => [intent.clientOrderId, intent])),
      ledgerEntries: Object.freeze([...snapshot.ledgerEntries]),
      trackedOrderIds,
      nextIntentSequence: snapshot.nextIntentSequence,
      referencePrice: snapshot.referencePrice,
      highestPrice: snapshot.highestPrice,
      lastAdjustmentPrice: snapshot.lastAdjustmentPrice,
      lastBuyPrice: snapshot.lastBuyPrice,
      trailingBuy: snapshot.trailingBuy,
      paused: snapshot.paused,
      cancelingOrderIds: new Set(),
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
      buyFills: 0,
      sellFills: 0,
      profitableCycles: 0,
      estimatedRealizedProfit: "0",
    },
  })
}
