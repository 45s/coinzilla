const MAX_ORDER_HISTORY_LIMIT = 1000

function validateOrderId({ orderId, index }) {
  const validStringId = typeof orderId === "string" && /^\d+$/.test(orderId)
  const validNumericId = Number.isSafeInteger(orderId) && orderId >= 0
  if ((!validStringId && !validNumericId) || !Number.isSafeInteger(Number(orderId))) {
    throw new TypeError(`Binance order history item ${index} has an invalid orderId`)
  }
  return String(orderId)
}

function validateOrderFields({ order, index, fields }) {
  for (const field of fields) {
    if (typeof order[field] !== "string" || order[field].length === 0) {
      throw new TypeError(`Binance order history item ${index} has an invalid ${field}`)
    }
  }
}

function validateOrder({ order, index }) {
  if (!order || typeof order !== "object" || Array.isArray(order)) {
    throw new TypeError(`Binance order history item ${index} must be an object`)
  }

  const orderId = validateOrderId({ orderId: order.orderId, index })
  if (!Number.isSafeInteger(order.time) || order.time < 0) {
    throw new TypeError(`Binance order history item ${index} has an invalid time`)
  }

  validateOrderFields({ order, index, fields: ["symbol", "side", "type", "status"] })
  validateOrderFields({ order, index, fields: ["price", "origQty", "executedQty", "cummulativeQuoteQty"] })
  if (order.clientOrderId !== undefined && typeof order.clientOrderId !== "string") {
    throw new TypeError(`Binance order history item ${index} has an invalid clientOrderId`)
  }

  return {
    time: order.time,
    orderId,
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
}

// Array.sort requires a two-argument comparator.
 // eslint-disable-next-line max-params
export const normalizeOrderHistory = ({ orders, limit = 20 }) => {
  if (!Array.isArray(orders)) {
    throw new TypeError("Binance order history must be an array")
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ORDER_HISTORY_LIMIT) {
    throw new RangeError(`Order history limit must be an integer between 1 and ${MAX_ORDER_HISTORY_LIMIT}`)
  }

  const normalizedOrders = orders.map((order, index) => ({
    order: validateOrder({ order, index }),
    index,
  }))
  normalizedOrders.sort((left, right) => {
    const leftTime = left.order.time
    const rightTime = right.order.time
    if (leftTime !== rightTime) {
      return rightTime - leftTime
    }
    const leftId = BigInt(left.order.orderId)
    const rightId = BigInt(right.order.orderId)
    if (leftId === rightId) {
      return left.index - right.index
    }
    return leftId > rightId ? -1 : 1
  })
  return { orders: normalizedOrders.slice(0, limit).map(({ order }) => order) }
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
