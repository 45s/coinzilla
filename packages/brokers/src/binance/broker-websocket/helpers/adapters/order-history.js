import {
  adaptCanonicalOrder,
  createCanonicalMarket,
} from "../../../shared/adapt-canonical-order.js"
import { normalizeBinanceId } from "../../../shared/normalize-binance-id.js"

export function requireOrderHistoryArray({ orders }) {
  if (!Array.isArray(orders)) {
    throw new TypeError("Binance allOrders response should be an array")
  }
  return orders
}

export function validateOrderHistoryCursorItems({ orders }) {
  for (const order of orders) {
    if (!order || typeof order !== "object" || Array.isArray(order)) {
      throw new TypeError("Binance allOrders response contains an invalid order")
    }
    normalizeBinanceId(order.orderId, "order history cursor ID")
  }
  return orders
}

export function createCanonicalOrderHistoryMarket({ symbol, exchangeInfo }) {
  const symbolMatches = Array.isArray(exchangeInfo?.symbols)
    ? exchangeInfo.symbols.filter((item) => item?.symbol === symbol)
    : []
  if (symbolMatches.length !== 1) {
    throw new Error(`Binance market metadata is missing or ambiguous for ${symbol}`)
  }
  return createCanonicalMarket({ symbolInfo: symbolMatches[0] })
}

export function adaptCanonicalOrderHistory({ orders, market }) {
  return orders.map((order) => adaptCanonicalOrder({ order, market }))
}
