import { toResult } from "@coinzilla/utils"
import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
  subtractDecimal,
} from "./helpers/decimal.js"

const LIVE_SELL_STATUSES = new Set(["OPEN", "PARTIALLY_FILLED"])
const TERMINAL_SELL_STATUSES = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED"])

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
  })
}

function validateCycle(cycle) {
  if (!cycle || typeof cycle !== "object" || Array.isArray(cycle)) {
    throw new Error("cycle must be an object")
  }
  if (!isNonEmptyString(cycle.id) || !isNonEmptyString(cycle.symbol) ||
      !isNonEmptyString(cycle.buyOrderId)) {
    throw new Error("cycle requires stable id, symbol, and BUY order ID")
  }
  if (!["OPEN", "COMPLETED"].includes(cycle.status)) {
    throw new Error("cycle has an unsupported status")
  }
  if (!Array.isArray(cycle.buyFillIds) || !Array.isArray(cycle.sellOrders) ||
      !Array.isArray(cycle.sellFills)) {
    throw new Error("cycle fill and order histories must be arrays")
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
  return true
}

function hasSameSellFill(left, right) {
  if (left.id !== right.id || left.orderId !== right.orderId) return false
  for (const field of ["quantity", "baseQuantity", "quoteQuantity"]) {
    try {
      if (compareDecimal({ left: left[field], right: right[field] }) !== 0) return false
    } catch {
      return false
    }
  }
  return true
}

// Create one immutable recovery cycle from a fully reconciled BUY order.
// The caller supplies actual net acquired base and actual quote cost.
export function createGridCycle({
  cycleId,
  symbol,
  buyOrderId,
  buyFillIds,
  acquiredQuantity,
  recoveryCost,
} = {}) {
  try {
    if (!isNonEmptyString(cycleId) || !isNonEmptyString(symbol) ||
        !isNonEmptyString(buyOrderId)) {
      throw new Error("cycleId, symbol, and buyOrderId must be non-empty strings")
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
      id: cycleId,
      symbol,
      buyOrderId,
      buyFillIds,
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
  quantity,
  reservedQuantity,
} = {}) {
  try {
    validateCycle(cycle)
    if (cycle.status !== "OPEN") throw new Error("completed cycles cannot receive SELL orders")
    if (!isNonEmptyString(orderId)) throw new Error("orderId must be a non-empty string")
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
    if (cycle.status !== "OPEN") throw new Error("completed cycles cannot receive SELL fills")
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

    const existingFill = cycle.sellFills.find((entry) => entry.id === fill.id)
    if (existingFill) {
      const candidate = {
        id: fill.id,
        orderId: fill.orderId,
        quantity: fill.quantity,
        baseQuantity: accounting.baseQuantity,
        quoteQuantity: accounting.quoteQuantity,
      }
      if (!hasSameSellFill(existingFill, candidate)) {
        throw new Error(`conflicting facts for SELL trade ${fill.id}`)
      }
      return toResult({ data: cycle, duplicate: true })
    }

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
      throw new Error("status must be CANCELED, REJECTED, or EXPIRED")
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
    const symbols = new Set()
    const totals = {
      activeQuantity: "0",
      freeQuantity: "0",
      reservedQuantity: "0",
      recoveryCost: "0",
      saleProceeds: "0",
      realizedProfit: "0",
      residualQuantity: "0",
      openCycles: 0,
      completedCycles: 0,
    }

    for (const cycle of cycles) {
      validateCycle(cycle)
      if (ids.has(cycle.id)) throw new Error(`duplicate cycle ID ${cycle.id}`)
      ids.add(cycle.id)
      symbols.add(cycle.symbol)

      totals.freeQuantity = addDecimal({
        left: totals.freeQuantity,
        right: cycle.freeQuantityAllocated,
      })
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
    return toResult({
      data: Object.freeze({
        ...(symbols.size === 1 ? { symbol: [...symbols][0] } : {}),
        ...totals,
      }),
    })
  } catch (error) {
    return fail(error.message)
  }
}
