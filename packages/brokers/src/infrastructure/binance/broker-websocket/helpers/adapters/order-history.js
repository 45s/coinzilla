import {
  adaptCanonicalOrder,
  createCanonicalMarket,
} from "../../../adapters/adapt-canonical-order.js"
import { normalizeBinanceId } from "../../../adapters/normalize-binance-id.js"

/** @param {{orders: unknown}} options @returns {object[]} Validated Binance order history page. */
export function requireOrderHistoryArray({ orders }) {
  if (!Array.isArray(orders)) {
    throw new TypeError("Binance allOrders response should be an array")
  }
  return orders
}

/** @param {{orders: object[]}} options @returns {object[]} Orders with valid non-negative exchange IDs. */
export function validateOrderHistoryCursorItems({ orders }) {
  for (const order of orders) {
    if (!order || typeof order !== "object" || Array.isArray(order)) {
      throw new TypeError("Binance allOrders response contains an invalid order")
    }
    normalizeBinanceId(order.orderId, "order history cursor ID")
  }
  return orders
}

/**
 * @param {{symbol: string, exchangeInfo: {symbols?: Array<object>}}} options
 * @returns {import("@coinzilla/entities").Market}
 */
export function createCanonicalOrderHistoryMarket({ symbol, exchangeInfo }) {
  const symbolMatches = Array.isArray(exchangeInfo?.symbols)
    ? exchangeInfo.symbols.filter((item) => item?.symbol === symbol)
    : []
  if (symbolMatches.length !== 1) {
    throw new Error(`Binance market metadata is missing or ambiguous for ${symbol}`)
  }
  return createCanonicalMarket({ symbolInfo: symbolMatches[0] })
}

const CANONICAL_ORDER_STATUSES = new Set([
  "NEW",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELED",
  "REJECTED",
  "EXPIRED",
  "EXPIRED_IN_MATCH",
])

/** @param {{orders: object[], symbol: string}} options @returns {object[]} */
export function validateCanonicalOrderHistoryItems({ orders, symbol }) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError("Canonical order history requires a symbol")
  }
  for (const order of orders) {
    if (typeof order.symbol !== "string" || order.symbol.trim().toUpperCase() !== symbol.trim().toUpperCase()) {
      throw new TypeError("Binance order history is missing or conflicts with the requested symbol")
    }
    if (typeof order.status !== "string" || !CANONICAL_ORDER_STATUSES.has(order.status.toUpperCase())) {
      throw new TypeError("Binance order history is missing or has an unsupported status")
    }
  }
  return orders
}

/**
 * @param {{orders: object[], market: import("@coinzilla/entities").Market}} options
 * @returns {import("@coinzilla/entities").CanonicalOrder[]}
 */
export function adaptCanonicalOrderHistory({ orders, market }) {
  validateCanonicalOrderHistoryItems({ orders, symbol: market?.symbol })
  return orders.map((order) => adaptCanonicalOrder({ order, market }))
}
