import { toResult } from "@coinzilla/utils"
import { projectGridCycles } from "./grid-cycles.js"

function failure(reason) {
  return toResult({ errors: [reason] })
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

// Build one canonical routing index for every order owned by a Grid cycle.
// Historical SELL attempts remain indexed so late stream/history fills can
// still be attributed to their original cycle after a replacement is placed.
export function buildGridOrderIndex({ cycles, pendingBuyOrder = null } = {}) {
  const projection = projectGridCycles({ cycles })
  if (!projection.ok) return projection

  if (pendingBuyOrder && cycles.some((cycle) => cycle.symbol !== pendingBuyOrder.symbol)) {
    return failure("Pending BUY order symbol does not match the cycle collection")
  }

  const byOrderId = Object.create(null)
  const byClientOrderId = Object.create(null)
  const entries = []
  const ordersToIndex = pendingBuyOrder
    ? [{
        order: pendingBuyOrder,
        role: "BUY",
        status: pendingBuyOrder.status ?? "OPEN",
        symbol: pendingBuyOrder.symbol,
        cycleId: null,
      }]
    : []

  for (const cycle of cycles) {
    ordersToIndex.push(
      {
        order: cycle.buyOrder,
        role: "BUY",
        status: "FILLED",
        symbol: cycle.symbol,
        cycleId: cycle.id,
      },
      ...cycle.sellOrders.map((order) => ({
        order,
        role: "SELL",
        status: order.status,
        symbol: cycle.symbol,
        cycleId: cycle.id,
      })),
    )
  }

  for (const { order, role, status, symbol, cycleId } of ordersToIndex) {
    if (!isNonEmptyString(order.id) || !isNonEmptyString(order.clientOrderId) ||
        !isNonEmptyString(symbol) || order.symbol !== symbol ||
        order.side !== role ||
        !["LIMIT", "LIMIT_MAKER"].includes(order.type) ||
        !isNonEmptyString(order.quantity) || !isNonEmptyString(order.price) ||
        !isNonEmptyString(status)) {
      return failure(`Grid ${role} order has incomplete or mismatched canonical identity`)
    }
    if (Object.hasOwn(byOrderId, order.id)) {
      return failure(`Grid broker order ID ${order.id} is assigned more than once`)
    }
    if (Object.hasOwn(byClientOrderId, order.clientOrderId)) {
      return failure(`Grid client order ID ${order.clientOrderId} is assigned more than once`)
    }

    const entry = Object.freeze({
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      symbol,
      side: order.side,
      role,
      status,
      cycleId,
    })
    byOrderId[order.id] = entry
    byClientOrderId[order.clientOrderId] = entry
    entries.push(entry)
  }

  return toResult({
    data: Object.freeze({
      orders: Object.freeze(entries),
      byOrderId: Object.freeze(byOrderId),
      byClientOrderId: Object.freeze(byClientOrderId),
    }),
  })
}

// Resolve an execution event by broker order ID and/or client order ID.
// When both are supplied, they must identify the same canonical order.
export function resolveGridOrderOwner({
  orderIndex,
  orderId,
  clientOrderId,
  symbol,
  side,
} = {}) {
  if (!orderIndex || typeof orderIndex !== "object" ||
      !orderIndex.byOrderId || !orderIndex.byClientOrderId) {
    return failure("A validated Grid order index is required")
  }
  if (!isNonEmptyString(orderId) && !isNonEmptyString(clientOrderId)) {
    return failure("A broker order ID or client order ID is required")
  }

  const byOrderId = isNonEmptyString(orderId)
    ? orderIndex.byOrderId[orderId]
    : null
  const byClientOrderId = isNonEmptyString(clientOrderId)
    ? orderIndex.byClientOrderId[clientOrderId]
    : null

  if (isNonEmptyString(orderId) && !byOrderId) {
    return failure(`Grid order ID ${orderId} is not tracked`)
  }
  if (isNonEmptyString(clientOrderId) && !byClientOrderId) {
    return failure(`Grid client order ID ${clientOrderId} is not tracked`)
  }
  if (byOrderId && byClientOrderId && byOrderId !== byClientOrderId) {
    return failure("Broker order ID and client order ID resolve to different Grid orders")
  }

  const owner = byOrderId ?? byClientOrderId
  if (symbol !== undefined && owner.symbol !== symbol) {
    return failure("Grid order event symbol does not match its tracked order")
  }
  if (side !== undefined && owner.side !== side) {
    return failure("Grid order event side does not match its tracked order")
  }

  return toResult({ data: { owner } })
}


// Compare the persisted live-order set with the exchange open-orders snapshot.
// Missing persisted orders are returned for final status/history lookup; they
// are never treated as absent or safe to replace.
export function reconcileGridOpenOrders({
  orderIndex,
  exchangeOpenOrders,
} = {}) {
  if (!orderIndex || !Array.isArray(orderIndex.orders) ||
      !orderIndex.byOrderId || !orderIndex.byClientOrderId ||
      !Array.isArray(exchangeOpenOrders)) {
    return failure("Grid open-order reconciliation requires a validated order index and exchange order array")
  }

  const exchangeOrderIds = new Set()
  const exchangeClientOrderIds = new Set()
  const matchedOrderIds = new Set()
  const matchedOrders = []

  for (const order of exchangeOpenOrders) {
    if (!order || typeof order !== "object" || Array.isArray(order) ||
        !isNonEmptyString(order.id) ||
        !isNonEmptyString(order.clientOrderId) ||
        !isNonEmptyString(order.symbol) ||
        !["BUY", "SELL"].includes(order.side) ||
        !["NEW", "PARTIALLY_FILLED"].includes(order.status)) {
      return failure("Exchange open-orders snapshot contains an invalid or non-open order")
    }
    if (exchangeOrderIds.has(order.id) ||
        exchangeClientOrderIds.has(order.clientOrderId)) {
      return failure("Exchange open-orders snapshot contains duplicate order identities")
    }
    exchangeOrderIds.add(order.id)
    exchangeClientOrderIds.add(order.clientOrderId)

    const resolved = resolveGridOrderOwner({
      orderIndex,
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
    })
    if (!resolved.ok) return resolved

    const { owner } = resolved.data
    if (!["OPEN", "NEW", "PARTIALLY_FILLED"].includes(owner.status)) {
      return failure(`Exchange reports terminal Grid order ${order.id} as open`)
    }
    matchedOrderIds.add(owner.orderId)
    matchedOrders.push(Object.freeze({
      orderId: owner.orderId,
      clientOrderId: owner.clientOrderId,
      cycleId: owner.cycleId,
      role: owner.role,
      exchangeStatus: order.status,
    }))
  }

  const missingOrders = orderIndex.orders
    .filter((entry) =>
      ["OPEN", "NEW", "PARTIALLY_FILLED"].includes(entry.status) &&
      !matchedOrderIds.has(entry.orderId),
    )
    .map((entry) => Object.freeze({
      orderId: entry.orderId,
      clientOrderId: entry.clientOrderId,
      symbol: entry.symbol,
      side: entry.side,
      cycleId: entry.cycleId,
      role: entry.role,
    }))

  return toResult({
    data: Object.freeze({
      complete: missingOrders.length === 0,
      matchedOrders: Object.freeze(matchedOrders),
      missingOrders: Object.freeze(missingOrders),
    }),
  })
}
