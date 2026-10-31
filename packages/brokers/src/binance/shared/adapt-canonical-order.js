import { Asset, CanonicalOrder, Market, Money, Quantity } from "@coinzilla/entities"

const ORDER_STATUS_MAP = Object.freeze({
  NEW: "OPEN",
  PARTIALLY_FILLED: "PARTIALLY_FILLED",
  FILLED: "FILLED",
  CANCELED: "CANCELED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  EXPIRED_IN_MATCH: "EXPIRED",
})

const ORDER_TYPES = new Set(["LIMIT", "LIMIT_MAKER", "MARKET"])
const TERMINAL_STATUSES = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED"])

function normalizeId({ value, name }) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+$/.test(String(value)) ||
    (typeof value === "number" && !Number.isSafeInteger(value)) ||
    !Number.isSafeInteger(Number(value))
  ) {
    throw new TypeError(`Binance order ${name} must be a non-negative safe integer`)
  }

  return String(value)
}

function normalizeTimestamp({ value, name }) {
  if (value === undefined || value === null) return undefined
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Binance order ${name} must be a non-negative safe integer`)
  }
  return value
}

function createAsset({ code }) {
  if (typeof code !== "string" || !code.trim()) {
    throw new TypeError("Binance order market asset code is missing")
  }
  const normalizedCode = code.trim().toUpperCase()
  return new Asset({ id: normalizedCode.toLowerCase(), code: normalizedCode })
}

export function adaptCanonicalOrder({ order, market } = {}) {
  if (!order || typeof order !== "object" || Array.isArray(order)) {
    throw new TypeError("Binance order should be an object")
  }
  if (!(market instanceof Market)) {
    throw new TypeError("Binance order requires a canonical Market")
  }

  const clientOrderId = order.clientOrderId
  if (typeof clientOrderId !== "string" || !clientOrderId.trim()) {
    throw new TypeError("Binance order is missing client order ID")
  }

  const type = typeof order.type === "string" ? order.type.toUpperCase() : ""
  if (!ORDER_TYPES.has(type)) {
    throw new TypeError(`Binance order type is unsupported: ${type || "unknown"}`)
  }

  const side = typeof order.side === "string" ? order.side.toUpperCase() : ""
  if (side !== "BUY" && side !== "SELL") {
    throw new TypeError("Binance order side is unsupported")
  }

  const rawStatus = typeof order.status === "string" ? order.status.toUpperCase() : ""
  const status = ORDER_STATUS_MAP[rawStatus] ?? "UNKNOWN"
  const originalQuantity = order.origQty
  const executedQuantity = order.executedQty
  if (typeof originalQuantity !== "string" || typeof executedQuantity !== "string") {
    throw new TypeError("Binance order quantities must be exact decimal strings")
  }

  const brokerOrderId = normalizeId({ value: order.orderId, name: "orderId" })
  const createdAt = normalizeTimestamp({ value: order.time, name: "time" })
  const updatedAt = normalizeTimestamp({ value: order.updateTime, name: "updateTime" })
  const limitPrice = type === "MARKET"
    ? undefined
    : new Money({ amount: order.price, asset: market.quoteAsset })

  return new CanonicalOrder({
    clientOrderId,
    brokerOrderId,
    market,
    side,
    type,
    ...(limitPrice ? { limitPrice } : {}),
    originalQuantity: new Quantity({ amount: originalQuantity, asset: market.baseAsset }),
    executedQuantity: new Quantity({ amount: executedQuantity, asset: market.baseAsset }),
    status,
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(TERMINAL_STATUSES.has(status) && updatedAt !== undefined
      ? { completedAt: updatedAt }
      : {}),
  })
}

export function createCanonicalMarket({ symbolInfo } = {}) {
  if (
    !symbolInfo ||
    typeof symbolInfo.symbol !== "string" ||
    !symbolInfo.symbol.trim()
  ) {
    throw new TypeError("Binance market metadata is missing a symbol")
  }

  return new Market({
    venue: "binance",
    symbol: symbolInfo.symbol,
    baseAsset: createAsset({ code: symbolInfo.baseAsset }),
    quoteAsset: createAsset({ code: symbolInfo.quoteAsset }),
  })
}
