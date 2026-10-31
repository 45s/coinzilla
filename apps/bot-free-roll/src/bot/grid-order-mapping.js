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

  const byOrderId = Object.create(null)
  const byClientOrderId = Object.create(null)
  const entries = []
  const ordersToIndex = pendingBuyOrder
    ? [{
        order: pendingBuyOrder,
        role: "BUY",
        status: pendingBuyOrder.status ?? "OPEN",
        cycleId: null,
      }]
    : []

  for (const cycle of cycles) {
    ordersToIndex.push(
      {
        order: cycle.buyOrder,
        role: "BUY",
        status: "FILLED",
        cycleId: cycle.id,
      },
      ...cycle.sellOrders.map((order) => ({
        order,
        role: "SELL",
        status: order.status,
        cycleId: cycle.id,
      })),
    )
  }

  for (const { order, role, status, cycleId } of ordersToIndex) {
      if (!isNonEmptyString(order.id) || !isNonEmptyString(order.clientOrderId)) {
        return failure(`Grid ${role} order has incomplete canonical identity`)
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
        symbol: cycle.symbol,
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
