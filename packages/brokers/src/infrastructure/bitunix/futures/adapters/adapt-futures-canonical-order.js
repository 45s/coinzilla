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
  if (compareDecimal({
    left: value,
    right: "0",
  }) < 0 || (!allowZero && compareDecimal({
    left: value,
    right: "0",
  }) === 0)) {
    throw new RangeError(`Bitunix Futures order ${field} is outside the valid range`)
  }
  return value
}

function normalizeOrderType({ order }) {
  const type = String(order.orderType ?? order.type ?? "").toUpperCase()
  if (!ORDER_TYPES.has(type)) {
    throw new TypeError(`Bitunix Futures order type is unsupported: ${type || "unknown"}`)
  }
  return type
}

function normalizeOrderStatus({ order }) {
  const status = typeof order.status === "string" ? order.status.toUpperCase() : ""
  if (!Object.hasOwn(ORDER_STATUS_MAP, status)) {
    return "UNKNOWN"
  }
  return ORDER_STATUS_MAP[status]
}

function validateOrderRow({ order, market }) {
  if (order === null || typeof order !== "object" || Array.isArray(order)) {
    throw new TypeError("Bitunix Futures order should be an object")
  }
  if (!market || market.symbol !== String(order.symbol ?? "").toUpperCase()) {
    throw new TypeError("Bitunix Futures order symbol does not match its canonical market")
  }

  const brokerOrderId = requireIdentifier({
    value: order.orderId,
    field: "orderId",
  })
  const clientOrderId = requireIdentifier({
    value: order.clientId,
    field: "clientId",
  })
  const side = String(order.side ?? "").toUpperCase()
  if (!ORDER_SIDES.has(side)) {
    throw new TypeError("Bitunix Futures order side is unsupported")
  }
  const type = normalizeOrderType({ order })
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

  const rawStatus = typeof order.status === "string" ? order.status.toUpperCase() : ""
  if (!Object.hasOwn(ORDER_STATUS_MAP, rawStatus)) {
    throw new TypeError(`Bitunix Futures order status is unsupported: ${rawStatus || "unknown"}`)
  }
  const status = normalizeOrderStatus({ order })
  const createdAt = requireTimestamp({
    value: order.ctime,
    field: "ctime",
  })
  const updatedAt = requireTimestamp({
    value: order.mtime,
    field: "mtime",
  })
  const limitPrice = type === "LIMIT"
    ? new Money({
      amount: requireDecimal({
        value: order.price,
        field: "price",
        allowZero: false,
      }),
      asset: market.quoteAsset,
    })
    : undefined

  return {
    clientOrderId,
    brokerOrderId,
    market,
    side,
    type,
    ...(limitPrice === undefined ? {} : { limitPrice }),
    originalQuantity: new Quantity({
      amount: originalAmount,
      asset: market.baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: executedAmount,
      asset: market.baseAsset,
    }),
    status,
    createdAt,
    acknowledgedAt: createdAt,
    updatedAt,
    ...(TERMINAL_STATUSES.has(status) ? { completedAt: updatedAt } : {}),
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
