import { compareDecimal, subtractDecimal } from "@coinzilla/utils"

function getLifecycleDetail({ order, status, quantity, executedQuantity, remainingQuantity } = {}) {
  if (status === "PARTIAL_FILL") {
    return "Executed: " + executedQuantity + " | Remaining: " + remainingQuantity
  }
  if (status === "CANCELLED") {
    return "Executed: " + executedQuantity + " | Cancelled: " + remainingQuantity
  }
  if (status === "SUBMITTED" && !order.brokerOrderId) {
    return "Client order ID: " + order.clientOrderId
  }
  if (status === "UNKNOWN" && !order.brokerOrderId) {
    return "Client order ID: " + order.clientOrderId
  }
  if (status === "STALE_CANCEL_IGNORED") {
    return "Already " + order.status
  }
  if (status === "CANCEL_UNKNOWN") {
    return "Cancellation outcome unknown; reconciliation required"
  }
  if (status === "CANCEL_NOT_SENT") {
    return "Broker cancellation was not sent"
  }
  if (status === "CANCEL_FAILED") {
    return "Cancellation request failed"
  }
  return undefined
}

export function createOrderLifecycleLogData({
  order,
  ownership,
  status,
  detail,
} = {}) {
  if (!order || typeof order !== "object") {
    throw new TypeError("Order lifecycle logging requires a canonical order")
  }
  if (typeof status !== "string" || !status.trim()) {
    throw new TypeError("Order lifecycle logging requires a lifecycle status")
  }

  const quantity = order.originalQuantity?.amount ?? "0"
  const executedQuantity = order.executedQuantity?.amount ?? "0"
  const remainingQuantity = subtractDecimal({
    left: quantity,
    right: executedQuantity,
  })
  const automaticDetail = getLifecycleDetail({
    order,
    status,
    quantity,
    executedQuantity,
    remainingQuantity,
  })

  return Object.freeze({
    message: "Order lifecycle",
    orderLifecycle: true,
    ...(ownership?.strategyId ? { strategyId: ownership.strategyId } : {}),
    lifecycleStatus: status,
    orderStatus: order.status,
    brokerOrderId: order.brokerOrderId,
    clientOrderId: order.clientOrderId,
    symbol: order.market?.symbol,
    side: order.side,
    quantity,
    executedQuantity,
    remainingQuantity,
    price: order.limitPrice?.amount,
    ...(detail ?? automaticDetail ? { detail: detail ?? automaticDetail } : {}),
  })
}

export function getOrderLifecycleStatus({ order, previousOrder } = {}) {
  if (!order || typeof order.status !== "string") return undefined

  if (previousOrder) {
    const previousExecuted = previousOrder.executedQuantity?.amount ?? "0"
    const currentExecuted = order.executedQuantity?.amount ?? "0"
    const executedChanged = compareDecimal({
      left: previousExecuted,
      right: currentExecuted,
    }) !== 0
    const statusChanged = previousOrder.status !== order.status
    const brokerOrderIdChanged = previousOrder.brokerOrderId !== order.brokerOrderId
    if (!statusChanged && !executedChanged && !brokerOrderIdChanged) {
      return undefined
    }
  }

  switch (order.status) {
    case "OPEN":
      return "ACCEPTED"
    case "PARTIALLY_FILLED":
      return "PARTIAL_FILL"
    case "FILLED":
      return "FILLED"
    case "CANCELED":
      return "CANCELLED"
    case "REJECTED":
      return "REJECTED"
    case "EXPIRED":
      return "EXPIRED"
    case "UNKNOWN":
      return "UNKNOWN"
    default:
      return undefined
  }
}

export function logOrderLifecycle({
  logger,
  order,
  ownership,
  status,
  method = "info",
  detail,
} = {}) {
  if (!logger || typeof logger !== "object") return false
  const write = typeof logger[method] === "function"
    ? logger[method].bind(logger)
    : typeof logger.info === "function"
      ? logger.info.bind(logger)
      : undefined
  if (!write) return false

  try {
    write(createOrderLifecycleLogData({
      order,
      ownership,
      status,
      detail,
    }))
    return true
  } catch {
    // Diagnostics must never change the outcome of a trading transition.
    return false
  }
}
