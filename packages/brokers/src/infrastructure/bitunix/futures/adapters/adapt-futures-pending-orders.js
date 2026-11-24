import {
  assertDecimalString,
  compareDecimal,
} from "@coinzilla/utils"

const SIDES = new Set(["BUY", "SELL"])
const ORDER_TYPES = new Set(["LIMIT", "MARKET"])
const ORDER_STATUSES = new Set(["INIT", "NEW", "PART_FILLED", "CANCELED", "FILLED"])
const POSITION_MODES = new Set(["ONE_WAY", "HEDGE"])
const MARGIN_MODES = new Set(["ISOLATION", "CROSS"])
const STOP_TYPES = new Set(["MARK_PRICE", "LAST_PRICE"])
const TP_SL_ORDER_TYPES = new Set(["LIMIT", "MARKET"])

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

function normalizeOptionalTrigger({ order, field, enumValues }) {
  if (order[field] === undefined || order[field] === null) {
    return undefined
  }
  return requireEnum({
    value: order[field],
    values: enumValues,
    field,
  })
}

function normalizePendingOrder({ order }) {
  if (order === null || typeof order !== "object" || Array.isArray(order)) {
    throw new TypeError("Bitunix Futures pending order should be an object")
  }
  const orderType = requireEnum({
    value: order.orderType ?? order.type,
    values: ORDER_TYPES,
    field: "orderType",
  })
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
  const clientId = order.clientId == null
    ? undefined
    : requireIdentifier({
      value: order.clientId,
      field: "clientId",
    })
  const price = orderType === "LIMIT"
    ? requireDecimal({
      value: order.price,
      field: "price",
      allowZero: false,
    })
    : undefined
  const effect = orderType === "LIMIT"
    ? requireEnum({
      value: order.effect,
      values: new Set(["GTC", "IOC", "FOK", "POST_ONLY"]),
      field: "effect",
    })
    : order.effect === undefined ? undefined : requireIdentifier({
      value: order.effect,
      field: "effect",
    })
  if (typeof order.reduceOnly !== "boolean") {
    throw new TypeError("Bitunix Futures pending order reduceOnly must be a boolean")
  }
  if (!Number.isSafeInteger(order.leverage) || order.leverage <= 0) {
    throw new TypeError("Bitunix Futures pending order leverage must be a positive safe integer")
  }

  const normalized = {
    orderId: requireIdentifier({
      value: order.orderId,
      field: "orderId",
    }),
    symbol: requireIdentifier({
      value: order.symbol,
      field: "symbol",
    }).toUpperCase(),
    quantity,
    executedQuantity,
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
    leverage: order.leverage,
    ...(price === undefined ? {} : { price }),
    side: requireEnum({
      value: order.side,
      values: SIDES,
      field: "side",
    }),
    orderType,
    ...(effect === undefined ? {} : { effect }),
    ...(clientId === undefined ? {} : { clientId }),
    reduceOnly: order.reduceOnly,
    status: requireEnum({
      value: order.status,
      values: ORDER_STATUSES,
      field: "status",
    }),
    fee: requireDecimal({
      value: order.fee,
      field: "fee",
    }),
    realizedPNL: requireDecimal({
      value: order.realizedPNL,
      field: "realizedPNL",
      allowNegative: true,
    }),
    createdAt: requireTimestamp({
      value: order.ctime,
      field: "ctime",
    }),
    updatedAt: requireTimestamp({
      value: order.mtime,
      field: "mtime",
    }),
  }

  for (const [source, target, enumValues] of [
    ["tpPrice", "takeProfitPrice", null],
    ["slPrice", "stopLossPrice", null],
    ["tpStopType", "takeProfitStopType", STOP_TYPES],
    ["slStopType", "stopLossStopType", STOP_TYPES],
    ["tpOrderType", "takeProfitOrderType", TP_SL_ORDER_TYPES],
    ["slOrderType", "stopLossOrderType", TP_SL_ORDER_TYPES],
  ]) {
    if (order[source] !== undefined && order[source] !== null) {
      normalized[target] = enumValues
        ? normalizeOptionalTrigger({ order, field: source, enumValues })
        : requireDecimal({
          value: order[source],
          field: source,
          allowZero: false,
        })
    }
  }
  for (const [source, target] of [
    ["tpOrderPrice", "takeProfitOrderPrice"],
    ["slOrderPrice", "stopLossOrderPrice"],
  ]) {
    if (order[source] !== undefined && order[source] !== null) {
      normalized[target] = requireDecimal({
        value: order[source],
        field: source,
        allowZero: false,
      })
    }
  }
  return Object.freeze(normalized)
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
