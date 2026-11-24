import {
  CanonicalOrder,
  Money,
  Quantity,
} from "@coinzilla/entities"
import {
  assertDecimalString,
  compareDecimal,
} from "@coinzilla/utils"

const ORDER_TYPES = new Set(["LIMIT", "MARKET"])
const ORDER_SIDES = new Set(["BUY", "SELL"])
const ORDER_STATUS_MAP = Object.freeze({
  INIT: "UNKNOWN",
  NEW: "OPEN",
  PART_FILLED: "PARTIALLY_FILLED",
  PART_FILLED_CANCELED: "CANCELED",
  FILLED: "FILLED",
  CANCELED: "CANCELED",
  EXPIRED: "EXPIRED",
})
const TERMINAL_STATUSES = new Set(["FILLED", "CANCELED", "EXPIRED"])

function requireIdentifier({ value, field }) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Bitunix Futures order ${field} must be a non-empty string`)
  }
  return value.trim()
}

function requireTimestamp({ value, field }) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Bitunix Futures order ${field} must be a non-negative safe integer`)
  }
  return value
}

function requireDecimal({ value, field, allowZero = true }) {
  assertDecimalString({
    value,
    field: `Bitunix Futures order ${field}`,
  })
  const comparison = compareDecimal({
    left: value,
    right: "0",
  })
  if (comparison < 0 || (!allowZero && comparison === 0)) {
    throw new RangeError(`Bitunix Futures order ${field} is outside the valid range`)
  }
  return value
}

function requireOrderObject({ order }) {
  if (order === null || typeof order !== "object" || Array.isArray(order)) {
    throw new TypeError("Bitunix Futures order should be an object")
  }
}

function requireOrderMarket({ order, market }) {
  const symbol = String(order.symbol ?? "").toUpperCase()
  if (!market || market.symbol !== symbol) {
    throw new TypeError("Bitunix Futures order symbol does not match its canonical market")
  }
}

function normalizeOrderIdentity({ order }) {
  const side = String(order.side ?? "").toUpperCase()
  if (!ORDER_SIDES.has(side)) {
    throw new TypeError("Bitunix Futures order side is unsupported")
  }
  return {
    brokerOrderId: requireIdentifier({
      value: order.orderId,
      field: "orderId",
    }),
    clientOrderId: requireIdentifier({
      value: order.clientId,
      field: "clientId",
    }),
    side,
  }
}

function normalizeOrderType({ order }) {
  const type = String(order.orderType ?? order.type ?? "").toUpperCase()
  if (!ORDER_TYPES.has(type)) {
    throw new TypeError(`Bitunix Futures order type is unsupported: ${type || "unknown"}`)
  }
  return type
}

function normalizeOrderQuantities({ order, market }) {
  const originalAmount = requireDecimal({
    value: order.qty,
    field: "qty",
    allowZero: false,
  })
  const executedAmount = requireDecimal({
    value: order.tradeQty,
    field: "tradeQty",
  })
  if (compareDecimal({
    left: executedAmount,
    right: originalAmount,
  }) > 0) {
    throw new RangeError("Bitunix Futures executed order quantity exceeds original quantity")
  }
  return {
    originalQuantity: new Quantity({
      amount: originalAmount,
      asset: market.baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: executedAmount,
      asset: market.baseAsset,
    }),
  }
}

function normalizeOrderLifecycle({ order }) {
  const rawStatus = typeof order.status === "string" ? order.status.toUpperCase() : ""
  if (!Object.hasOwn(ORDER_STATUS_MAP, rawStatus)) {
    throw new TypeError(`Bitunix Futures order status is unsupported: ${rawStatus || "unknown"}`)
  }
  const createdAt = requireTimestamp({
    value: order.ctime,
    field: "ctime",
  })
  const updatedAt = requireTimestamp({
    value: order.mtime,
    field: "mtime",
  })
  const status = ORDER_STATUS_MAP[rawStatus]
  return {
    status,
    createdAt,
    updatedAt,
    ...(TERMINAL_STATUSES.has(status) ? { completedAt: updatedAt } : {}),
  }
}

function normalizeLimitPrice({ order, type, market }) {
  if (type !== "LIMIT") {
    return undefined
  }
  return new Money({
    amount: requireDecimal({
      value: order.price,
      field: "price",
      allowZero: false,
    }),
    asset: market.quoteAsset,
  })
}

function validateOrderRow({ order, market }) {
  requireOrderObject({
    order,
  })
  requireOrderMarket({
    order,
    market,
  })
  const identity = normalizeOrderIdentity({
    order,
  })
  const type = normalizeOrderType({
    order,
  })
  const quantities = normalizeOrderQuantities({
    order,
    market,
  })
  const lifecycle = normalizeOrderLifecycle({
    order,
  })
  const limitPrice = normalizeLimitPrice({
    order,
    type,
    market,
  })
  return {
    ...identity,
    market,
    type,
    ...quantities,
    ...lifecycle,
    ...(limitPrice === undefined ? {} : { limitPrice }),
  }
}

/**
 * Convert a Bitunix Futures order DTO into the shared canonical order entity.
 * Client identity is mandatory: this adapter never manufactures a client ID.
 */
export function adaptFuturesCanonicalOrder({ order, market } = {}) {
  return new CanonicalOrder(validateOrderRow({
    order,
    market,
  }))
}
