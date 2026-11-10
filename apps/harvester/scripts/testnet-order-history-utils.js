const MAX_ORDER_HISTORY_LIMIT = 1000

export const normalizeOrderHistory = ({ orders, limit = 20 }) => {
  if (!Array.isArray(orders)) {
    throw new TypeError("Binance order history must be an array")
  }

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ORDER_HISTORY_LIMIT) {
    throw new RangeError(`Order history limit must be an integer between 1 and ${MAX_ORDER_HISTORY_LIMIT}`)
  }

  const normalizedOrders = orders.map((order, index) => {
    if (!order || typeof order !== "object" || Array.isArray(order)) {
      throw new TypeError(`Binance order history item ${index} must be an object`)
    }

    const orderId = order.orderId
    const validOrderId =
      (typeof orderId === "string" && /^\d+$/.test(orderId)) ||
      (Number.isSafeInteger(orderId) && orderId >= 0)

    if (!validOrderId || !Number.isSafeInteger(Number(orderId))) {
      throw new TypeError(`Binance order history item ${index} has an invalid orderId`)
    }

    if (!Number.isSafeInteger(order.time) || order.time < 0) {
      throw new TypeError(`Binance order history item ${index} has an invalid time`)
    }

    for (const field of ["symbol", "side", "type", "status"]) {
      if (typeof order[field] !== "string" || order[field].length === 0) {
        throw new TypeError(`Binance order history item ${index} has an invalid ${field}`)
      }
    }

    for (const field of ["price", "origQty", "executedQty", "cummulativeQuoteQty"]) {
      if (typeof order[field] !== "string") {
        throw new TypeError(`Binance order history item ${index} has an invalid ${field}`)
      }
    }

    if (order.clientOrderId !== undefined && typeof order.clientOrderId !== "string") {
      throw new TypeError(`Binance order history item ${index} has an invalid clientOrderId`)
    }

    return {
      time: order.time,
      orderId: String(orderId),
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      price: order.price,
      quantity: order.origQty,
      executed: order.executedQty,
      quote: order.cummulativeQuoteQty,
      status: order.status,
      clientOrderId: order.clientOrderId ?? "",
    }
  })

  normalizedOrders.sort((left, right) => {
    if (left.time !== right.time) return right.time - left.time
    const leftId = BigInt(left.orderId)
    const rightId = BigInt(right.orderId)
    return leftId === rightId ? 0 : leftId > rightId ? -1 : 1
  })

  return { orders: normalizedOrders.slice(0, limit) }
}

export const parseOrderHistoryArguments = ({ args = [] } = {}) => {
  if (!Array.isArray(args) || args.length > 2) {
    throw new TypeError("Usage: testnet:history [SYMBOL] [LIMIT]")
  }

  const symbol = String(args[0] ?? "ZROUSDT").toUpperCase()
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
    throw new TypeError("Symbol must contain 5-20 letters or numbers")
  }

  const limit = args[1] === undefined ? 20 : Number(args[1])
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ORDER_HISTORY_LIMIT) {
    throw new RangeError(`Limit must be an integer between 1 and ${MAX_ORDER_HISTORY_LIMIT}`)
  }

  return { symbol, limit }
}
