import { CanonicalOrder, Market, Money, Quantity } from "@coinzilla/entities"
import { assertDecimalString } from "@coinzilla/utils"

const BINANCE_ORDER_STATUS_MAP = Object.freeze({
  NEW: "OPEN",
  PARTIALLY_FILLED: "PARTIALLY_FILLED",
  FILLED: "FILLED",
  CANCELED: "CANCELED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  EXPIRED_IN_MATCH: "EXPIRED",
})

const terminalStatuses = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED"])

/**
 * Convert one normalized Binance execution report into the canonical order
 * state entity. The raw Binance status mapping stays in infrastructure.
 */
export function createCanonicalOrderFromBinanceEvent({ event, market } = {}) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("Binance order event must be an object")
  }
  if (event.eventType !== "executionReport") {
    throw new TypeError("Binance event is not an execution report")
  }
  if (!(market instanceof Market)) {
    throw new TypeError("Binance order normalization requires a canonical Market")
  }
  if (!event.executedOrder || typeof event.executedOrder !== "object" ||
      Array.isArray(event.executedOrder)) {
    throw new TypeError("Binance execution report is missing order facts")
  }

  const order = event.executedOrder
  for (const [field, value] of Object.entries({
    brokerOrderId: order.id,
    clientOrderId: order.clientOrderId,
  })) {
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError("Binance order " + field + " must be a non-empty string")
    }
  }
  if (typeof order.symbol !== "string" || order.symbol.trim().toUpperCase() !== market.symbol) {
    throw new TypeError("Binance order symbol does not match its Market")
  }
  if (order.side !== "BUY" && order.side !== "SELL") {
    throw new TypeError("Binance order side is invalid")
  }
  if (!["LIMIT", "LIMIT_MAKER", "MARKET"].includes(order.type)) {
    throw new TypeError("Binance order type is unsupported: " + order.type)
  }

  assertDecimalString({ value: order.quantity, field: "order.quantity" })
  assertDecimalString({ value: order.executedQuantity, field: "order.executedQuantity" })
  const status = BINANCE_ORDER_STATUS_MAP[order.status] ?? "UNKNOWN"
  const limitPrice = order.type === "MARKET"
    ? undefined
    : new Money({
        amount: assertDecimalString({ value: order.price, field: "order.price" }),
        asset: market.quoteAsset,
      })
  const updatedAt = Number.isSafeInteger(order.updatedAt) && order.updatedAt >= 0
    ? order.updatedAt
    : undefined
  const createdAt = Number.isSafeInteger(order.createdAt) && order.createdAt >= 0
    ? order.createdAt
    : undefined

  return new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.id,
    market,
    side: order.side,
    type: order.type,
    ...(limitPrice ? { limitPrice } : {}),
    originalQuantity: new Quantity({
      amount: order.quantity,
      asset: market.baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: order.executedQuantity,
      asset: market.baseAsset,
    }),
    status,
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(status === "UNKNOWN" || updatedAt === undefined
      ? {}
      : { acknowledgedAt: updatedAt }),
    ...(terminalStatuses.has(status) && updatedAt !== undefined
      ? { completedAt: updatedAt }
      : {}),
  })
}
