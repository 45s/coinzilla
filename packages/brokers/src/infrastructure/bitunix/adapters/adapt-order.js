import { Order } from "@coinzilla/entities"
import { assertDecimalString, compareDecimal, subtractDecimal } from "@coinzilla/utils"

const SIDE_MAP = Object.freeze({
  "1": "SELL",
  "2": "BUY",
})
const TYPE_MAP = Object.freeze({
  "1": "LIMIT",
  "2": "MARKET",
})
const STATUS_MAP = Object.freeze({
  "1": "OPEN",
  "2": "FILLED",
  "3": "PARTIALLY_FILLED",
  "4": "CANCELED",
  "7": "PARTIALLY_FILLED_CANCELED",
})

function assertOrderQuantities({ volume, dealVolume }) {
  assertDecimalString({
    value: volume,
    field: "Bitunix Spot original base quantity",
  })
  assertDecimalString({
    value: dealVolume,
    field: "Bitunix Spot executed base quantity",
  })
  if (compareDecimal({
    left: volume,
    right: "0",
  }) < 0 ||
      compareDecimal({
        left: dealVolume,
        right: "0",
      }) < 0 ||
      compareDecimal({
        left: dealVolume,
        right: volume,
      }) > 0) {
    throw new TypeError("Bitunix Spot order quantities are outside the valid range")
  }
}

function assertRequiredTimestamp({ value, field }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Bitunix Spot order ${field} must be a non-empty string`)
  }
}

function validateOrderIdentity({ orderId, symbol, ctime, utime }) {
  if ((typeof orderId !== "string" && typeof orderId !== "number") ||
      (typeof orderId === "string" && orderId.trim() === "") ||
      (typeof orderId === "number" && !Number.isSafeInteger(orderId))) {
    throw new TypeError("Bitunix Spot order ID must be a non-empty string or safe integer")
  }
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError("Bitunix Spot order is missing symbol")
  }
  assertRequiredTimestamp({ value: ctime, field: "ctime" })
  assertRequiredTimestamp({ value: utime, field: "utime" })
}

function normalizeOrderStatus({ status }) {
  if ((typeof status !== "string" && typeof status !== "number") || String(status).trim() === "") {
    throw new TypeError("Bitunix Spot order status must be a non-empty string or number")
  }
  const exchangeStatus = String(status)
  return {
    exchangeStatus,
    normalizedStatus: STATUS_MAP[exchangeStatus] ?? "UNKNOWN",
  }
}

function validateOrder({ bitunixOrder }) {
  if (!bitunixOrder || typeof bitunixOrder !== "object" || Array.isArray(bitunixOrder)) {
    throw new TypeError("Bitunix Spot order should be an object")
  }
  const {
    orderId,
    symbol,
    side,
    type,
    status,
    volume,
    dealVolume,
    price,
    ctime,
    utime,
  } = bitunixOrder
  validateOrderIdentity({ orderId, symbol, ctime, utime })

  const normalizedSide = SIDE_MAP[String(side)]
  const normalizedType = TYPE_MAP[String(type ?? bitunixOrder.orderType)]
  const { exchangeStatus, normalizedStatus } = normalizeOrderStatus({ status })
  if (!normalizedSide) {
    throw new TypeError("Bitunix Spot order side is unsupported")
  }
  if (!normalizedType) {
    throw new TypeError("Bitunix Spot order type is unsupported")
  }
  assertOrderQuantities({
    volume,
    dealVolume,
  })
  if (normalizedType === "LIMIT") {
    assertDecimalString({
      value: price,
      field: "Bitunix Spot limit price",
    })
  }

  return {
    orderId,
    symbol,
    normalizedSide,
    normalizedType,
    normalizedStatus,
    exchangeStatus,
    volume,
    dealVolume,
    price,
  }
}

/**
 * Adapt a Bitunix Spot open/history order row to the legacy broker Order entity.
 *
 * @param {Record<string, unknown>} bitunixOrder
 * @returns {import("@coinzilla/entities").Order}
 */
export function adaptOrder(bitunixOrder) {
  const {
    orderId,
    symbol,
    normalizedSide,
    normalizedType,
    normalizedStatus,
    exchangeStatus,
    volume,
    dealVolume,
    price,
  } = validateOrder({ bitunixOrder })
  const remainingQuantity = subtractDecimal({
    left: volume,
    right: dealVolume,
  })
  const order = new Order({
    type: normalizedType,
    side: normalizedSide,
    symbol: symbol.trim().toUpperCase(),
    quantity: Number(remainingQuantity),
    price: normalizedType === "MARKET" ? 0 : Number(price),
    id: String(orderId),
  })

  order.originalPrice = normalizedType === "MARKET" ? undefined : String(price)
  order.originalQuantity = String(volume)
  order.executedQuantity = String(dealVolume)
  order.remainingQuantity = remainingQuantity
  order.status = normalizedStatus
  if (normalizedStatus === "UNKNOWN") {
    order.exchangeStatus = exchangeStatus
  }
  order.createdAt = bitunixOrder.ctime
  order.updatedAt = bitunixOrder.utime
  return order
}
