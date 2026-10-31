import { toResult } from "@coinzilla/utils"
import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
  subtractDecimal,
} from "./helpers/decimal.js"

const LIVE_SELL_STATUSES = new Set(["OPEN", "PARTIALLY_FILLED"])
const TERMINAL_SELL_STATUSES = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"])

function fail(reason) {
  return toResult({ errors: [reason] })
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function validateDecimal({ value, name, allowZero = true }) {
  assertDecimalString(value, name)
  const comparison = compareDecimal({ left: value, right: "0" })
  if (comparison < 0 || (!allowZero && comparison === 0)) {
    throw new Error(`${name} must be ${allowZero ? "non-negative" : "positive"}`)
  }
}

function freezeCycle(cycle) {
  return Object.freeze({
    ...cycle,
    buyFillIds: Object.freeze([...cycle.buyFillIds]),
    sellOrders: Object.freeze(cycle.sellOrders.map((order) => Object.freeze({ ...order }))),
    sellFills: Object.freeze(cycle.sellFills.map((fill) => Object.freeze({ ...fill }))),
    commissionTotals: Object.freeze({ ...cycle.commissionTotals }),
    buyOrder: Object.freeze({ ...cycle.buyOrder }),
  })
}

function validateCycle(cycle) {
  if (!cycle || typeof cycle !== "object" || Array.isArray(cycle)) {
    throw new Error("cycle must be an object")
  }
  if (!isNonEmptyString(cycle.id) || !isNonEmptyString(cycle.symbol) ||
      !isNonEmptyString(cycle.buyOrderId) || !isNonEmptyString(cycle.baseAsset) ||
      !isNonEmptyString(cycle.quoteAsset) || cycle.baseAsset === cycle.quoteAsset) {
    throw new Error("cycle requires stable identity and distinct base/quote assets")
  }
  const buyOrder = cycle.buyOrder
  if (!buyOrder || typeof buyOrder !== "object" ||
      buyOrder.id !== cycle.buyOrderId ||
      buyOrder.symbol !== cycle.symbol ||
      buyOrder.side !== "BUY" ||
      !isNonEmptyString(buyOrder.clientOrderId) ||
      !["LIMIT", "LIMIT_MAKER"].includes(buyOrder.type)) {
    throw new Error("cycle requires complete canonical BUY order identity")
  }
  validateDecimal({ value: buyOrder.quantity, name: "BUY order quantity", allowZero: false })
  validateDecimal({ value: buyOrder.price, name: "BUY order price", allowZero: false })
  const expectedId = `grid-cycle:${cycle.symbol.length}:${cycle.symbol}:${cycle.buyOrderId.length}:${cycle.buyOrderId}`
  if (cycle.id !== expectedId) throw new Error("cycle ID does not match its BUY order identity")
  if (!cycle.commissionTotals || typeof cycle.commissionTotals !== "object" ||
      Array.isArray(cycle.commissionTotals)) {
    throw new Error("cycle commission totals must be an asset map")
  }
  for (const [asset, amount] of Object.entries(cycle.commissionTotals)) {
    if (asset !== cycle.baseAsset && asset !== cycle.quoteAsset) {
      throw new Error("cycle contains an unsupported commission asset")
    }
    validateDecimal({ value: amount, name: `commissionTotals.${asset}` })
  }
  if (!["OPEN", "COMPLETED"].includes(cycle.status)) {
    throw new Error("cycle has an unsupported status")
  }
  if (!Array.isArray(cycle.buyFillIds) || !Array.isArray(cycle.sellOrders) ||
      !Array.isArray(cycle.sellFills)) {
    throw new Error("cycle fill and order histories must be arrays")
  }
  if (cycle.buyFillIds.length === 0 ||
      cycle.buyFillIds.some((id) => !isNonEmptyString(id)) ||
      new Set(cycle.buyFillIds).size !== cycle.buyFillIds.length) {
    throw new Error("cycle BUY fill identities must be stable and unique")
  }

  for (const [name, value] of Object.entries({
    acquiredQuantity: cycle.acquiredQuantity,
    remainingQuantity: cycle.remainingQuantity,
    recoveryCost: cycle.recoveryCost,
    saleProceeds: cycle.saleProceeds,
    soldBaseQuantity: cycle.soldBaseQuantity,
    freeQuantityAllocated: cycle.freeQuantityAllocated,
    residualQuantity: cycle.residualQuantity,
    realizedProfit: cycle.realizedProfit,
  })) {
    validateDecimal({ value, name })
  }
  if (compareDecimal({ left: cycle.acquiredQuantity, right: "0" }) <= 0 ||
      compareDecimal({ left: cycle.recoveryCost, right: "0" }) <= 0) {
    throw new Error("cycle acquired quantity and recovery cost must be positive")
  }

  const ordersById = new Map()
  const clientOrderIds = new Set([buyOrder.clientOrderId])
  const liveOrders = []
  const filledQuantityByOrder = new Map()
  for (const order of cycle.sellOrders) {
    if (!order || typeof order !== "object" || !isNonEmptyString(order.id) ||
        !isNonEmptyString(order.clientOrderId) || clientOrderIds.has(order.clientOrderId) ||
        order.symbol !== cycle.symbol || order.side !== "SELL" ||
        !["LIMIT", "LIMIT_MAKER"].includes(order.type) || ordersById.has(order.id) ||
        !["OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"].includes(order.status)) {
      throw new Error("cycle contains an invalid or duplicate SELL order")
    }
    validateDecimal({ value: order.price, name: "SELL order price", allowZero: false })
    validateDecimal({ value: order.quantity, name: "SELL quantity", allowZero: false })
    validateDecimal({ value: order.filledQuantity, name: "SELL filledQuantity" })
    validateDecimal({ value: order.reservedQuantity, name: "SELL reservedQuantity" })
    if (compareDecimal({ left: order.filledQuantity, right: order.quantity }) > 0) {
      throw new Error("SELL filledQuantity exceeds order quantity")
    }
    if (LIVE_SELL_STATUSES.has(order.status)) {
      liveOrders.push(order)
      if (compareDecimal({ left: order.reservedQuantity, right: "0" }) <= 0) {
        throw new Error("live SELL order must retain a positive reservation")
      }
      if (compareDecimal({ left: order.reservedQuantity, right: cycle.remainingQuantity }) > 0) {
        throw new Error("live SELL reservation exceeds cycle remaining quantity")
      }
    } else if (compareDecimal({ left: order.reservedQuantity, right: "0" }) !== 0) {
      throw new Error("terminal SELL order cannot retain a reservation")
    }
    if (order.status === "FILLED" &&
        compareDecimal({ left: order.filledQuantity, right: order.quantity }) !== 0) {
      throw new Error("FILLED SELL order must have its full quantity reconciled")
    }
    clientOrderIds.add(order.clientOrderId)
    ordersById.set(order.id, order)
    filledQuantityByOrder.set(order.id, "0")
  }
  if (liveOrders.length > 1) {
    throw new Error("cycle cannot have more than one live SELL order")
  }
  if ((liveOrders.length === 0 && cycle.currentSellOrderId !== null) ||
      (liveOrders.length === 1 && cycle.currentSellOrderId !== liveOrders[0].id)) {
    throw new Error("cycle current SELL order does not match its live order")
  }

  const fillIds = new Set()
  const sellCommissionTotals = new Map()
  let totalSoldBase = "0"
  let totalSaleProceeds = "0"
  for (const fill of cycle.sellFills) {
    if (!fill || typeof fill !== "object" ||
        !isNonEmptyString(fill.id) || !isNonEmptyString(fill.orderId) ||
        fillIds.has(fill.id) || !ordersById.has(fill.orderId)) {
      throw new Error("cycle contains an invalid, duplicate, or unowned SELL fill")
    }
    validateDecimal({ value: fill.quantity, name: "SELL fill quantity", allowZero: false })
    validateDecimal({ value: fill.baseQuantity, name: "SELL fill baseQuantity", allowZero: false })
    validateDecimal({ value: fill.quoteQuantity, name: "SELL fill quoteQuantity" })
    validateDecimal({ value: fill.commissionAmount, name: "SELL fill commissionAmount" })
    if (compareDecimal({ left: fill.baseQuantity, right: fill.quantity }) < 0) {
      throw new Error("SELL fill base debit cannot be smaller than gross quantity")
    }
    if (compareDecimal({ left: fill.commissionAmount, right: "0" }) > 0 &&
        fill.commissionAsset !== cycle.baseAsset &&
        fill.commissionAsset !== cycle.quoteAsset) {
      throw new Error("cycle SELL fill contains an unsupported commission asset")
    }
    if (compareDecimal({ left: fill.commissionAmount, right: "0" }) === 0 &&
        fill.commissionAsset !== null) {
      throw new Error("zero-commission SELL fill must not specify a commission asset")
    }
    if (compareDecimal({ left: fill.commissionAmount, right: "0" }) > 0) {
      sellCommissionTotals.set(
        fill.commissionAsset,
        addDecimal({
          left: sellCommissionTotals.get(fill.commissionAsset) ?? "0",
          right: fill.commissionAmount,
        }),
      )
    }
    fillIds.add(fill.id)
    filledQuantityByOrder.set(fill.orderId, addDecimal({
      left: filledQuantityByOrder.get(fill.orderId),
      right: fill.quantity,
    }))
    totalSoldBase = addDecimal({ left: totalSoldBase, right: fill.baseQuantity })
    totalSaleProceeds = addDecimal({ left: totalSaleProceeds, right: fill.quoteQuantity })
  }
  for (const [orderId, filledQuantity] of filledQuantityByOrder) {
    if (compareDecimal({
      left: filledQuantity,
      right: ordersById.get(orderId).filledQuantity,
    }) !== 0) {
      throw new Error("SELL order filled quantity does not match its cycle fill history")
    }
  }
  if (compareDecimal({ left: totalSoldBase, right: cycle.soldBaseQuantity }) !== 0 ||
      compareDecimal({ left: totalSaleProceeds, right: cycle.saleProceeds }) !== 0) {
    throw new Error("cycle accounting totals do not match its SELL fill history")
  }
  for (const [asset, amount] of sellCommissionTotals) {
    if (compareDecimal({
      left: cycle.commissionTotals[asset] ?? "0",
      right: amount,
    }) < 0) {
      throw new Error("cycle commission totals do not include all SELL fill commissions")
    }
  }

  if (cycle.status === "OPEN") {
    if (compareDecimal({
      left: addDecimal({ left: cycle.remainingQuantity, right: cycle.soldBaseQuantity }),
      right: cycle.acquiredQuantity,
    }) !== 0 ||
        compareDecimal({ left: cycle.freeQuantityAllocated, right: "0" }) !== 0 ||
        compareDecimal({ left: cycle.residualQuantity, right: "0" }) !== 0 ||
        compareDecimal({ left: cycle.realizedProfit, right: "0" }) !== 0) {
      throw new Error("open cycle inventory or completion totals are inconsistent")
    }
  } else if (
    compareDecimal({ left: cycle.remainingQuantity, right: "0" }) !== 0 ||
    compareDecimal({
      left: addDecimal({
        left: addDecimal({ left: cycle.soldBaseQuantity, right: cycle.freeQuantityAllocated }),
        right: cycle.residualQuantity,
      }),
      right: cycle.acquiredQuantity,
    }) !== 0 ||
    compareDecimal({
      left: cycle.realizedProfit,
      right: subtractDecimal({ left: cycle.saleProceeds, right: cycle.recoveryCost }),
    }) !== 0 ||
    liveOrders.length > 0
  ) {
    throw new Error("completed cycle inventory or accounting totals are inconsistent")
  }
  return true
}

function hasSameSellFill(left, right) {
  if (left.id !== right.id || left.orderId !== right.orderId ||
      left.commissionAsset !== right.commissionAsset) return false
  for (const field of ["quantity", "baseQuantity", "quoteQuantity", "commissionAmount"]) {
    try {
      if (compareDecimal({ left: left[field], right: right[field] }) !== 0) return false
    } catch {
      return false
    }
  }
  return true
}

// Cycle identity is deterministic across event replay and process restart.
// BUY order IDs are scoped by market; length prefixes avoid delimiter collisions.
export function createGridCycleId({ symbol, buyOrderId } = {}) {
  if (!isNonEmptyString(symbol) || !isNonEmptyString(buyOrderId)) {
    return fail("symbol and buyOrderId must be non-empty strings")
  }
  return toResult({
    data: {
      cycleId: `grid-cycle:${symbol.length}:${symbol}:${buyOrderId.length}:${buyOrderId}`,
    },
  })
}

// Create one immutable recovery cycle from a fully reconciled BUY order.
// The caller supplies actual net acquired base, actual quote cost, and the
// commission totals already captured for the BUY fills.
export function createGridCycle({
  symbol,
  baseAsset,
  quoteAsset,
  buyOrder,
  buyOrderId,
  buyFillIds,
  acquiredQuantity,
  recoveryCost,
  buyCommissionTotals = {},
} = {}) {
  try {
    if (!isNonEmptyString(symbol) || !isNonEmptyString(buyOrderId) ||
        !isNonEmptyString(baseAsset) || !isNonEmptyString(quoteAsset) ||
        baseAsset === quoteAsset) {
      throw new Error("symbol, BUY order ID, and distinct base/quote assets are required")
    }
    if (!buyOrder || typeof buyOrder !== "object" || buyOrder.id !== buyOrderId ||
        buyOrder.symbol !== symbol || buyOrder.side !== "BUY" ||
        !isNonEmptyString(buyOrder.clientOrderId) ||
        !["LIMIT", "LIMIT_MAKER"].includes(buyOrder.type)) {
      throw new Error("buyOrder must contain the complete canonical BUY order identity")
    }
    if (!buyCommissionTotals || typeof buyCommissionTotals !== "object" ||
        Array.isArray(buyCommissionTotals)) {
      throw new Error("buyCommissionTotals must be an asset map")
    }
    const identity = createGridCycleId({ symbol, buyOrderId })
    if (!identity.ok) throw new Error(identity.errors[0])
    for (const [asset, amount] of Object.entries(buyCommissionTotals)) {
      if (asset !== baseAsset && asset !== quoteAsset) {
        throw new Error(`Unsupported BUY commission asset: ${asset}`)
      }
      validateDecimal({ value: amount, name: `buyCommissionTotals.${asset}` })
    }
    if (!Array.isArray(buyFillIds) || buyFillIds.length === 0 ||
        buyFillIds.some((id) => !isNonEmptyString(id))) {
      throw new Error("buyFillIds must contain at least one stable fill ID")
    }
    if (new Set(buyFillIds).size !== buyFillIds.length) {
      throw new Error("buyFillIds must not contain duplicates")
    }
    validateDecimal({ value: acquiredQuantity, name: "acquiredQuantity", allowZero: false })
    validateDecimal({ value: recoveryCost, name: "recoveryCost", allowZero: false })

    const cycle = freezeCycle({
      id: identity.data.cycleId,
      symbol,
      baseAsset,
      quoteAsset,
      buyOrderId,
      buyOrder,
      buyFillIds,
      commissionTotals: buyCommissionTotals,
      status: "OPEN",
      acquiredQuantity,
      remainingQuantity: acquiredQuantity,
      recoveryCost,
      saleProceeds: "0",
      soldBaseQuantity: "0",
      sellOrders: [],
      currentSellOrderId: null,
      sellFills: [],
      freeQuantityAllocated: "0",
      residualQuantity: "0",
      realizedProfit: "0",
    })
    return toResult({ data: cycle })
  } catch (error) {
    return fail(error.message)
  }
}

// A cycle may have only one live SELL attempt. Replacements append a new
// attempt after the previous attempt has been reconciled and closed.
export function appendGridCycleSellOrder({
  cycle,
  orderId,
  clientOrderId,
  type,
  price,
  quantity,
  reservedQuantity,
} = {}) {
  try {
    validateCycle(cycle)
    if (cycle.status !== "OPEN") throw new Error("completed cycles cannot receive SELL orders")
    if (!isNonEmptyString(orderId) || !isNonEmptyString(clientOrderId) ||
        !["LIMIT", "LIMIT_MAKER"].includes(type)) {
      throw new Error("SELL order requires broker ID, clientOrderId, and supported type")
    }
    validateDecimal({ value: price, name: "SELL order price", allowZero: false })
    if (cycle.sellOrders.some((order) => order.id === orderId)) {
      throw new Error(`SELL order ${orderId} is already recorded for this cycle`)
    }
    if (cycle.currentSellOrderId !== null) {
      throw new Error("cycle already has a live SELL order")
    }
    validateDecimal({ value: quantity, name: "quantity", allowZero: false })
    validateDecimal({ value: reservedQuantity, name: "reservedQuantity", allowZero: false })
    if (compareDecimal({ left: reservedQuantity, right: quantity }) < 0) {
      throw new Error("reservedQuantity cannot be smaller than SELL quantity")
    }
    if (compareDecimal({ left: reservedQuantity, right: cycle.remainingQuantity }) > 0) {
      throw new Error("SELL reservation exceeds cycle remaining quantity")
    }

    const order = {
      id: orderId,
      clientOrderId,
      symbol: cycle.symbol,
      side: "SELL",
      type,
      price,
      quantity,
      filledQuantity: "0",
      reservedQuantity,
      status: "OPEN",
    }
    return toResult({
      data: freezeCycle({
        ...cycle,
        sellOrders: [...cycle.sellOrders, order],
        currentSellOrderId: orderId,
      }),
    })
  } catch (error) {
    return fail(error.message)
  }
}

// Apply one already-normalized SELL fill. accounting.baseQuantity includes
// any base-asset commission debit; accounting.quoteQuantity is net quote
// proceeds after an eligible quote-asset commission.
export function recordGridCycleSellFill({ cycle, fill, accounting } = {}) {
  try {
    validateCycle(cycle)
    if (!fill || typeof fill !== "object" || Array.isArray(fill)) {
      throw new Error("fill must be an object")
    }
    if (!isNonEmptyString(fill.id) || !isNonEmptyString(fill.orderId)) {
      throw new Error("SELL fill requires stable trade and order IDs")
    }
    if (fill.side !== "SELL") throw new Error("cycle accepts SELL fills only")
    if (!accounting || typeof accounting !== "object") {
      throw new Error("SELL fill accounting is required")
    }
    validateDecimal({ value: fill.quantity, name: "fill.quantity", allowZero: false })
    validateDecimal({ value: accounting.baseQuantity, name: "accounting.baseQuantity", allowZero: false })
    validateDecimal({ value: accounting.quoteQuantity, name: "accounting.quoteQuantity" })
    if (fill.symbol !== undefined && fill.symbol !== cycle.symbol) {
      throw new Error("SELL fill market does not match its cycle")
    }
    if (compareDecimal({ left: accounting.baseQuantity, right: fill.quantity }) < 0) {
      throw new Error("SELL base debit cannot be smaller than gross fill quantity")
    }
    const commissionAmount = String(fill.commissionAmount ?? "0")
    validateDecimal({ value: commissionAmount, name: "fill.commissionAmount" })
    const hasCommission = compareDecimal({ left: commissionAmount, right: "0" }) > 0
    const commissionAsset = hasCommission ? fill.commissionAsset : null
    if (hasCommission && !isNonEmptyString(commissionAsset)) {
      throw new Error("non-zero SELL commission requires an asset")
    }
    if (commissionAsset !== null &&
        commissionAsset !== cycle.baseAsset &&
        commissionAsset !== cycle.quoteAsset) {
      throw new Error("SELL commission asset is not the cycle base or quote asset")
    }

    const existingFill = cycle.sellFills.find((entry) => entry.id === fill.id)
    if (existingFill) {
      const candidate = {
        id: fill.id,
        orderId: fill.orderId,
        quantity: fill.quantity,
        baseQuantity: accounting.baseQuantity,
        quoteQuantity: accounting.quoteQuantity,
        commissionAmount,
        commissionAsset,
      }
      if (!hasSameSellFill(existingFill, candidate)) {
        throw new Error(`conflicting facts for SELL trade ${fill.id}`)
      }
      return toResult({ data: cycle, duplicate: true })
    }
    if (cycle.status !== "OPEN") throw new Error("completed cycles cannot receive new SELL fills")

    if (cycle.currentSellOrderId !== fill.orderId) {
      throw new Error(`SELL fill ${fill.id} does not belong to the current cycle order`)
    }
    const orderIndex = cycle.sellOrders.findIndex((order) => order.id === fill.orderId)
    const order = cycle.sellOrders[orderIndex]
    if (!order || !LIVE_SELL_STATUSES.has(order.status)) {
      throw new Error("SELL fill references an order that is not live")
    }

    const nextFilledQuantity = addDecimal({
      left: order.filledQuantity,
      right: fill.quantity,
    })
    if (compareDecimal({ left: nextFilledQuantity, right: order.quantity }) > 0) {
      throw new Error("SELL fills exceed the submitted order quantity")
    }
    if (compareDecimal({ left: order.reservedQuantity, right: accounting.baseQuantity }) < 0) {
      throw new Error("SELL fill consumes more than its reserved cycle inventory")
    }
    if (compareDecimal({ left: cycle.remainingQuantity, right: accounting.baseQuantity }) < 0) {
      throw new Error("SELL fill consumes more than the cycle owns")
    }

    const isFilled = compareDecimal({ left: nextFilledQuantity, right: order.quantity }) === 0
    const nextOrder = {
      ...order,
      filledQuantity: nextFilledQuantity,
      reservedQuantity: isFilled
        ? "0"
        : subtractDecimal({
            left: order.reservedQuantity,
            right: accounting.baseQuantity,
          }),
      status: isFilled ? "FILLED" : "PARTIALLY_FILLED",
    }
    const sellOrders = cycle.sellOrders.map((entry, index) =>
      index === orderIndex ? nextOrder : entry,
    )
    const sellFill = {
      id: fill.id,
      orderId: fill.orderId,
      quantity: fill.quantity,
      baseQuantity: accounting.baseQuantity,
      quoteQuantity: accounting.quoteQuantity,
      commissionAmount,
      commissionAsset,
    }
    const commissionTotals = { ...cycle.commissionTotals }
    if (commissionAsset !== null) {
      commissionTotals[commissionAsset] = addDecimal({
        left: commissionTotals[commissionAsset] ?? "0",
        right: commissionAmount,
      })
    }

    return toResult({
      data: freezeCycle({
        ...cycle,
        remainingQuantity: subtractDecimal({
          left: cycle.remainingQuantity,
          right: accounting.baseQuantity,
        }),
        saleProceeds: addDecimal({
          left: cycle.saleProceeds,
          right: accounting.quoteQuantity,
        }),
        soldBaseQuantity: addDecimal({
          left: cycle.soldBaseQuantity,
          right: accounting.baseQuantity,
        }),
        sellOrders,
        currentSellOrderId: isFilled ? null : cycle.currentSellOrderId,
        sellFills: [...cycle.sellFills, sellFill],
        commissionTotals,
      }),
      duplicate: false,
    })
  } catch (error) {
    return fail(error.message)
  }
}

// Close a canceled/rejected/expired SELL only after its final status and fills
// have been reconciled by the broker boundary. This releases only that order's
// remaining reservation; already-recorded fills remain in cycle accounting.
export function closeGridCycleSellOrder({
  cycle,
  orderId,
  status,
  reconciled,
} = {}) {
  try {
    validateCycle(cycle)
    if (cycle.status !== "OPEN") throw new Error("completed cycles cannot close SELL orders")
    if (reconciled !== true) {
      throw new Error("SELL order cannot close before final fill reconciliation")
    }
    if (!TERMINAL_SELL_STATUSES.has(status) || status === "FILLED") {
      throw new Error("status must be CANCELED, REJECTED, EXPIRED, or EXPIRED_IN_MATCH")
    }
    if (cycle.currentSellOrderId !== orderId) {
      throw new Error("only the current cycle SELL order can be closed")
    }
    const orderIndex = cycle.sellOrders.findIndex((order) => order.id === orderId)
    const order = cycle.sellOrders[orderIndex]
    if (!order || !LIVE_SELL_STATUSES.has(order.status)) {
      throw new Error("SELL order is not live")
    }

    const sellOrders = cycle.sellOrders.map((entry, index) =>
      index === orderIndex
        ? { ...entry, status, reservedQuantity: "0" }
        : entry,
    )
    return toResult({
      data: freezeCycle({
        ...cycle,
        sellOrders,
        currentSellOrderId: null,
      }),
    })
  } catch (error) {
    return fail(error.message)
  }
}

// Complete one cycle after all its SELL attempts are terminal and actual
// reconciled net proceeds satisfy that cycle's own profit requirement.
export function completeGridCycle({ cycle, keepQuantity, minProfit } = {}) {
  try {
    validateCycle(cycle)
    if (cycle.status !== "OPEN") throw new Error("cycle is already completed")
    validateDecimal({ value: keepQuantity, name: "keepQuantity" })
    validateDecimal({ value: minProfit, name: "minProfit", allowZero: false })
    if (cycle.currentSellOrderId !== null ||
        cycle.sellOrders.length === 0 ||
        cycle.sellOrders.some((order) => LIVE_SELL_STATUSES.has(order.status))) {
      throw new Error("cycle cannot complete while a SELL order is live or missing")
    }
    if (compareDecimal({
      left: cycle.saleProceeds,
      right: addDecimal({ left: cycle.recoveryCost, right: minProfit }),
    }) < 0) {
      throw new Error("cycle has not recovered its cost and minimum net profit")
    }
    if (compareDecimal({ left: cycle.remainingQuantity, right: keepQuantity }) < 0) {
      throw new Error("cycle does not have enough remaining quantity for keep allocation")
    }

    const realizedProfit = subtractDecimal({
      left: cycle.saleProceeds,
      right: cycle.recoveryCost,
    })
    const residualQuantity = subtractDecimal({
      left: cycle.remainingQuantity,
      right: keepQuantity,
    })
    return toResult({
      data: freezeCycle({
        ...cycle,
        status: "COMPLETED",
        remainingQuantity: "0",
        freeQuantityAllocated: keepQuantity,
        residualQuantity,
        realizedProfit,
      }),
    })
  } catch (error) {
    return fail(error.message)
  }
}

// Pair-level statistics are a projection, never a second mutable source of
// truth. Completed-cycle residuals remain active but are not free inventory.
export function projectGridCycles({ cycles } = {}) {
  try {
    if (!Array.isArray(cycles)) throw new Error("cycles must be an array")
    const ids = new Set()
    const orderIds = new Set()
    const clientOrderIds = new Set()
    const symbols = new Set()
    const totals = {
      activeQuantity: "0",
      freeQuantity: "0",
      reservedQuantity: "0",
      recoveryCost: "0",
      saleProceeds: "0",
      realizedProfit: "0",
      residualQuantity: "0",
      commissionTotals: {},
      openCycles: 0,
      completedCycles: 0,
    }

    for (const cycle of cycles) {
      validateCycle(cycle)
      if (ids.has(cycle.id)) throw new Error(`duplicate cycle ID ${cycle.id}`)
      ids.add(cycle.id)
      symbols.add(cycle.symbol)
      if (orderIds.has(cycle.buyOrder.id)) {
        throw new Error("BUY broker order ID is assigned to multiple Grid orders")
      }
      orderIds.add(cycle.buyOrder.id)
      if (clientOrderIds.has(cycle.buyOrder.clientOrderId)) {
        throw new Error("BUY client order ID is assigned to multiple cycles")
      }
      clientOrderIds.add(cycle.buyOrder.clientOrderId)

      totals.freeQuantity = addDecimal({
        left: totals.freeQuantity,
        right: cycle.freeQuantityAllocated,
      })
      for (const [asset, amount] of Object.entries(cycle.commissionTotals)) {
        totals.commissionTotals[asset] = addDecimal({
          left: totals.commissionTotals[asset] ?? "0",
          right: amount,
        })
      }
      if (cycle.status === "COMPLETED") {
        totals.completedCycles += 1
        totals.residualQuantity = addDecimal({
          left: totals.residualQuantity,
          right: cycle.residualQuantity,
        })
        totals.activeQuantity = addDecimal({
          left: totals.activeQuantity,
          right: cycle.residualQuantity,
        })
        totals.realizedProfit = addDecimal({
          left: totals.realizedProfit,
          right: cycle.realizedProfit,
        })
      } else {
        totals.openCycles += 1
        totals.activeQuantity = addDecimal({
          left: totals.activeQuantity,
          right: cycle.remainingQuantity,
        })
        totals.recoveryCost = addDecimal({
          left: totals.recoveryCost,
          right: cycle.recoveryCost,
        })
        totals.saleProceeds = addDecimal({
          left: totals.saleProceeds,
          right: cycle.saleProceeds,
        })
      }

      for (const order of cycle.sellOrders) {
        if (orderIds.has(order.id)) {
          throw new Error(`SELL order ${order.id} is assigned to multiple cycles`)
        }
        orderIds.add(order.id)
        if (clientOrderIds.has(order.clientOrderId)) {
          throw new Error(`client order ID ${order.clientOrderId} is assigned to multiple Grid orders`)
        }
        clientOrderIds.add(order.clientOrderId)
        if (LIVE_SELL_STATUSES.has(order.status)) {
          validateDecimal({ value: order.reservedQuantity, name: "SELL reservedQuantity" })
          totals.reservedQuantity = addDecimal({
            left: totals.reservedQuantity,
            right: order.reservedQuantity,
          })
        }
      }
    }

    if (symbols.size > 1) throw new Error("all cycles in a pair projection must use the same symbol")
    if (compareDecimal({ left: totals.reservedQuantity, right: totals.activeQuantity }) > 0) {
      throw new Error("pair SELL reservations exceed strategy-owned active inventory")
    }
    return toResult({
      data: Object.freeze({
        ...(symbols.size === 1 ? { symbol: [...symbols][0] } : {}),
        ...totals,
        commissionTotals: Object.freeze({ ...totals.commissionTotals }),
      }),
    })
  } catch (error) {
    return fail(error.message)
  }
}
