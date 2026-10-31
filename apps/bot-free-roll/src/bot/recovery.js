import { addDecimal, compareDecimal } from "./helpers/decimal.js"
import { getOrderId } from "./helpers/exchange.js"

function failure(reason) {
  return { ok: false, reason }
}

export function validateRecoveryBalances({ balances } = {}) {
  if (!Array.isArray(balances)) {
    return failure("Balance snapshot must be an array")
  }

  const snapshot = new Map()

  for (const balance of balances) {
    const asset = balance?.asset?.code
    const free = balance?.free?.amount
    const locked = balance?.locked?.amount
    const total = balance?.total?.amount

    if (typeof asset !== "string" || !asset ||
        typeof free !== "string" || typeof locked !== "string" ||
        typeof total !== "string") {
      return failure("Balance snapshot contains an incomplete canonical Balance")
    }
    if (snapshot.has(asset)) {
      return failure(`Balance snapshot contains duplicate asset ${asset}`)
    }

    try {
      if (compareDecimal({ left: free, right: "0" }) < 0 ||
          compareDecimal({ left: locked, right: "0" }) < 0 ||
          compareDecimal({ left: total, right: addDecimal({ left: free, right: locked }) }) !== 0) {
        return failure(`Balance snapshot contains inconsistent quantities for ${asset}`)
      }
    } catch (error) {
      return failure(`Balance snapshot contains invalid quantities for ${asset}: ${error.message}`)
    }

    snapshot.set(asset, { free, locked, total })
  }

  return { ok: true, balances: snapshot }
}

export function reconcileTrackedOrder({
  symbol,
  order,
  openOrders,
  fills,
} = {}) {
  const orderId = getOrderId(order)
  if (!symbol || !orderId || !order ||
      typeof order.quantity !== "string" ||
      !Array.isArray(openOrders) || !Array.isArray(fills)) {
    return failure("Tracked order reconciliation input is incomplete")
  }
  if (fills.length >= 1000) {
    return failure(`Trade history for order ${orderId} may be truncated`)
  }

  const seenTradeIds = new Set()
  let historyQuantity = "0"

  try {
    for (const fill of fills) {
      const fillId = String(fill?.id ?? "")
      if (!fillId || fillId === "undefined" || fillId === "-1" ||
          String(fill?.orderId) !== orderId ||
          fill?.symbol !== symbol ||
          fill?.side !== order.side ||
          typeof fill.quantity !== "string" ||
          compareDecimal({ left: fill.quantity, right: "0" }) <= 0) {
        return failure(`Trade history for order ${orderId} contains an invalid or mismatched fill`)
      }
      if (seenTradeIds.has(fillId)) continue
      seenTradeIds.add(fillId)
      historyQuantity = addDecimal({
        left: historyQuantity,
        right: fill.quantity,
      })
    }

    const matchingOpenOrders = openOrders.filter(
      (candidate) => getOrderId(candidate) === orderId,
    )
    if (matchingOpenOrders.length > 1) {
      return failure(`Open order ${orderId} appears more than once in the broker snapshot`)
    }

    const remoteOrder = matchingOpenOrders[0]
    if (remoteOrder) {
      const originalQuantity = remoteOrder.originalQuantity
      const executedQuantity = remoteOrder.executedQuantity
      const status = String(remoteOrder.status ?? "").toUpperCase()

      if (typeof originalQuantity !== "string" ||
          typeof executedQuantity !== "string") {
        return failure(`Open order ${orderId} is missing exact quantities`)
      }

      const executedComparison = compareDecimal({
        left: executedQuantity,
        right: originalQuantity,
      })

      if ((remoteOrder.symbol !== undefined && remoteOrder.symbol !== symbol) ||
          String(remoteOrder.side ?? "") !== order.side ||
          compareDecimal({ left: originalQuantity, right: order.quantity }) !== 0 ||
          !["NEW", "PARTIALLY_FILLED"].includes(status) ||
          compareDecimal({ left: executedQuantity, right: historyQuantity }) !== 0 ||
          (status === "NEW" &&
            compareDecimal({ left: executedQuantity, right: "0" }) !== 0) ||
          (status === "PARTIALLY_FILLED" &&
            (compareDecimal({ left: executedQuantity, right: "0" }) <= 0 ||
              executedComparison >= 0))) {
        return failure(`Open order ${orderId} does not match its complete trade history`)
      }

      return { ok: true, status: "OPEN", historyQuantity, remoteOrder }
    }

    if (compareDecimal({ left: historyQuantity, right: order.quantity }) === 0) {
      return { ok: true, status: "FILLED", historyQuantity }
    }

    return failure(
      `Order ${orderId} is absent from open orders and its complete trade history does not prove a full fill`,
    )
  } catch (error) {
    return failure(`Could not reconcile order ${orderId}: ${error.message}`)
  }
}
