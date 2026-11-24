import {
  assertDecimalString,
  compareDecimal,
} from "@coinzilla/utils"

const SIDES = new Set(["BUY", "SELL"])
const ORDER_TYPES = new Set(["LIMIT", "MARKET"])
const ORDER_STATUSES = new Set(["INIT", "NEW", "PART_FILLED", "CANCELED", "FILLED"])
const POSITION_MODES = new Set(["ONE_WAY", "HEDGE"])
const MARGIN_MODES = new Set(["ISOLATION", "CROSS"])
const STOP_TYPES = new Set(["MARK", "MARK_PRICE", "LAST_PRICE"])
const TP_SL_ORDER_TYPES = new Set(["LIMIT", "MARKET"])
const ORDER_EFFECTS = new Set(["GTC", "IOC", "FOK", "POST_ONLY"])

function requireIdentifier({ value, field }) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Bitunix Futures pending order ${field} must be a non-empty string`)
  }
  return value.trim()
}

function requireDecimal({ value, field, allowNegative = false, allowZero = true }) {
  assertDecimalString({
    value,
    field: `Bitunix Futures pending order ${field}`,
  })
  const comparison = compareDecimal({
    left: value,
    right: "0",
  })
  if ((!allowNegative && comparison < 0) || (!allowZero && comparison === 0)) {
    throw new RangeError(`Bitunix Futures pending order ${field} is outside the valid range`)
  }
  return value
}

function requireEnum({ value, values, field }) {
  if (!values.has(value)) {
    throw new TypeError(`Bitunix Futures pending order ${field} is unsupported`)
  }
  return value
}

function requireTimestamp({ value, field }) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Bitunix Futures pending order ${field} must be a non-negative safe integer`)
  }
  return value
}

function requirePendingOrderObject({ order }) {
  if (order === null || typeof order !== "object" || Array.isArray(order)) {
    throw new TypeError("Bitunix Futures pending order should be an object")
  }
}

function normalizePendingOrderIdentity({ order }) {
  const clientId = order.clientId == null
    ? undefined
    : requireIdentifier({
      value: order.clientId,
      field: "clientId",
    })
  return {
    orderId: requireIdentifier({
      value: order.orderId,
      field: "orderId",
    }),
    symbol: requireIdentifier({
      value: order.symbol,
      field: "symbol",
    }).toUpperCase(),
    ...(clientId === undefined ? {} : { clientId }),
    side: requireEnum({
      value: order.side,
      values: SIDES,
      field: "side",
    }),
    positionMode: requireEnum({
      value: order.positionMode,
      values: POSITION_MODES,
      field: "positionMode",
    }),
    marginMode: requireEnum({
      value: order.marginMode,
      values: MARGIN_MODES,
      field: "marginMode",
    }),
  }
}

function normalizePendingOrderQuantities({ order }) {
  const quantity = requireDecimal({
    value: order.qty,
    field: "qty",
    allowZero: false,
  })
  const executedQuantity = requireDecimal({
    value: order.tradeQty,
    field: "tradeQty",
  })
  if (compareDecimal({
    left: executedQuantity,
    right: quantity,
  }) > 0) {
    throw new RangeError("Bitunix Futures pending order executed quantity exceeds original quantity")
  }
  return {
    quantity,
    executedQuantity,
  }
}

function normalizePendingOrderType({ order }) {
  return requireEnum({
    value: order.orderType ?? order.type,
    values: ORDER_TYPES,
    field: "orderType",
  })
}

function normalizePendingOrderPrice({ order, orderType }) {
  if (orderType !== "LIMIT") {
    return undefined
  }
  return requireDecimal({
    value: order.price,
    field: "price",
    allowZero: false,
  })
}

function normalizePendingOrderEffect({ order, orderType }) {
  if (orderType === "LIMIT") {
    return requireEnum({
      value: order.effect,
      values: ORDER_EFFECTS,
      field: "effect",
    })
  }
  if (order.effect === undefined || order.effect === null) {
    return undefined
  }
  return requireIdentifier({
    value: order.effect,
    field: "effect",
  })
}

function normalizePendingOrderSettings({ order }) {
  if (typeof order.reduceOnly !== "boolean") {
    throw new TypeError("Bitunix Futures pending order reduceOnly must be a boolean")
  }
  if (!Number.isSafeInteger(order.leverage) || order.leverage <= 0) {
    throw new TypeError("Bitunix Futures pending order leverage must be a positive safe integer")
  }
  return {
    leverage: order.leverage,
    reduceOnly: order.reduceOnly,
    status: requireEnum({
      value: order.status,
      values: ORDER_STATUSES,
      field: "status",
    }),
  }
}

function normalizePendingOrderFinancials({ order }) {
  return {
    fee: requireDecimal({
      value: order.fee,
      field: "fee",
    }),
    realizedPNL: requireDecimal({
      value: order.realizedPNL,
      field: "realizedPNL",
      allowNegative: true,
    }),
  }
}

function normalizePendingOrderTimestamps({ order }) {
  return {
    createdAt: requireTimestamp({
      value: order.ctime,
      field: "ctime",
    }),
    updatedAt: requireTimestamp({
      value: order.mtime,
      field: "mtime",
    }),
  }
}

function normalizeOptionalTrigger({ order, source, target, enumValues }) {
  if (order[source] === undefined || order[source] === null) {
    return undefined
  }
  if (enumValues) {
    return {
      [target]: requireEnum({
        value: order[source],
        values: enumValues,
        field: source,
      }),
    }
  }
  return {
    [target]: requireDecimal({
      value: order[source],
      field: source,
      allowZero: false,
    }),
  }
}

function validateTriggerOrderPrice({ order, orderTypeField, orderPriceField }) {
  if (order[orderTypeField] === "LIMIT" &&
      (order[orderPriceField] === undefined || order[orderPriceField] === null)) {
    throw new TypeError(`Bitunix Futures pending order ${orderPriceField} is required for a LIMIT trigger order`)
  }
}

function normalizePendingOrderTriggers({ order }) {
  validateTriggerOrderPrice({
    order,
    orderTypeField: "tpOrderType",
    orderPriceField: "tpOrderPrice",
  })
  validateTriggerOrderPrice({
    order,
    orderTypeField: "slOrderType",
    orderPriceField: "slOrderPrice",
  })
  const fields = [
    ["tpPrice", "takeProfitPrice"],
    ["slPrice", "stopLossPrice"],
    ["tpStopType", "takeProfitStopType", STOP_TYPES],
    ["slStopType", "stopLossStopType", STOP_TYPES],
    ["tpOrderType", "takeProfitOrderType", TP_SL_ORDER_TYPES],
    ["slOrderType", "stopLossOrderType", TP_SL_ORDER_TYPES],
    ["tpOrderPrice", "takeProfitOrderPrice"],
    ["slOrderPrice", "stopLossOrderPrice"],
  ]
  const normalized = {}
  for (const field of fields) {
    const [source, target, enumValues] = field
    Object.assign(normalized, normalizeOptionalTrigger({
      order,
      source,
      target,
      enumValues,
    }))
  }
  return normalized
}

function normalizePendingOrder({ order }) {
  requirePendingOrderObject({
    order,
  })
  const orderType = normalizePendingOrderType({
    order,
  })
  const price = normalizePendingOrderPrice({
    order,
    orderType,
  })
  const effect = normalizePendingOrderEffect({
    order,
    orderType,
  })
  return Object.freeze({
    ...normalizePendingOrderIdentity({
      order,
    }),
    ...normalizePendingOrderQuantities({
      order,
    }),
    ...normalizePendingOrderSettings({
      order,
    }),
    ...normalizePendingOrderFinancials({
      order,
    }),
    ...normalizePendingOrderTimestamps({
      order,
    }),
    ...(price === undefined ? {} : { price }),
    ...(effect === undefined ? {} : { effect }),
    orderType,
    ...normalizePendingOrderTriggers({
      order,
    }),
  })
}

export function adaptFuturesPendingOrders({ rows } = {}) {
  if (!Array.isArray(rows)) {
    throw new TypeError("Bitunix Futures orderList must be an array")
  }
  const orders = rows.map((order) => normalizePendingOrder({
    order,
  }))
  const orderIds = new Set()
  for (const order of orders) {
    if (orderIds.has(order.orderId)) {
      throw new TypeError("Bitunix Futures pending orders contain duplicate order IDs")
    }
    orderIds.add(order.orderId)
  }
  return Object.freeze(orders)
}
