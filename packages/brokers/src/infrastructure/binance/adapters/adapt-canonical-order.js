import { Asset, CanonicalOrder, Market, Money, Quantity } from "@coinzilla/entities"
import { normalizeBinanceId } from "./normalize-binance-id.js"

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

function normalizeTimestamp({ value, name }) {
  if (value === undefined || value === null) {return undefined}
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
  return new Asset({ id: normalizedCode.toLowerCase(),
code: normalizedCode })
}

function validateOrderInput({ order, market }) {
  if (!order || typeof order !== "object" || Array.isArray(order)) {
    throw new TypeError("Binance order should be an object")
  }
  if (!(market instanceof Market)) {
    throw new TypeError("Binance order requires a canonical Market")
  }
}

function normalizeClientOrderId(order) {
  const { clientOrderId } = order
  if (typeof clientOrderId !== "string" || !clientOrderId.trim()) {
    throw new TypeError("Binance order is missing client order ID")
  }
  return clientOrderId
}

function normalizeOrderType(order) {
  const type = typeof order.type === "string" ? order.type.toUpperCase() : ""
  if (!ORDER_TYPES.has(type)) {
    throw new TypeError(`Binance order type is unsupported: ${type || "unknown"}`)
  }
  return type
}

function normalizeOrderSide(order) {
  const side = typeof order.side === "string" ? order.side.toUpperCase() : ""
  if (side !== "BUY" && side !== "SELL") {
    throw new TypeError("Binance order side is unsupported")
  }
  return side
}

function normalizeOrderStatus(order) {
  const rawStatus = typeof order.status === "string" ? order.status.toUpperCase() : ""
  return ORDER_STATUS_MAP[rawStatus] ?? "UNKNOWN"
}

function normalizeOrderQuantities(order) {
  const originalQuantity = order.origQty
  const executedQuantity = order.executedQty
  if (typeof originalQuantity !== "string" || typeof executedQuantity !== "string") {
    throw new TypeError("Binance order quantities must be exact decimal strings")
  }
  return { originalQuantity,
    executedQuantity }
}

function normalizeOrderTimestamps(order) {
  return {
    createdAt: normalizeTimestamp({ value: order.time,
      name: "time" }),
    updatedAt: normalizeTimestamp({ value: order.updateTime,
      name: "updateTime" }),
  }
}

function createOrderLimitPrice({ type, order, market }) {
  if (type === "MARKET") {return undefined}
  return new Money({ amount: order.price,
    asset: market.quoteAsset })
}

function createCanonicalOrderDetails({ order, market }) {
  validateOrderInput({ order,
    market })
  const clientOrderId = normalizeClientOrderId(order)
  const type = normalizeOrderType(order)
  const side = normalizeOrderSide(order)
  const status = normalizeOrderStatus(order)
  const { originalQuantity, executedQuantity } = normalizeOrderQuantities(order)
  const brokerOrderId = normalizeBinanceId(order.orderId, "order ID")
  const { createdAt, updatedAt } = normalizeOrderTimestamps(order)
  const limitPrice = createOrderLimitPrice({ type,
    order,
    market })

  return {
    clientOrderId,
    brokerOrderId,
    market,
    side,
    type,
    ...(limitPrice ? { limitPrice } : {}),
    originalQuantity: new Quantity({ amount: originalQuantity,
      asset: market.baseAsset }),
    executedQuantity: new Quantity({ amount: executedQuantity,
      asset: market.baseAsset }),
    status,
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(TERMINAL_STATUSES.has(status) && updatedAt !== undefined
      ? { completedAt: updatedAt }
      : {}),
  }
}

/**
 * Convert a Binance order DTO into the canonical order entity.
 *
 * @param {{order: Record<string, unknown>, market: import("@coinzilla/entities").Market}} options
 * @returns {import("@coinzilla/entities").CanonicalOrder}
 * @throws {TypeError} If the order, market, identifiers, side, type, or decimal quantities are invalid.
 */
export function adaptCanonicalOrder({ order, market } = {}) {
  return new CanonicalOrder(createCanonicalOrderDetails({ order,
    market }))
}

/**
 * Build a canonical market from Binance exchangeInfo symbol metadata.
 *
 * @param {{symbolInfo: {symbol: string, baseAsset: string, quoteAsset: string}}} options
 * @returns {import("@coinzilla/entities").Market}
 * @throws {TypeError} If the symbol or asset codes are missing or invalid.
 */
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
