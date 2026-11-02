import { CanonicalOrder, Market, Money, Quantity } from "@coinzilla/entities"
import { assertDecimalString } from "@coinzilla/utils"

/**
 * Build the local PENDING order aggregate before submitting it to a broker.
 * This pure function validates strategy intent and assigns no broker identity.
 */
export function createPendingCanonicalOrder({
  order,
  market,
  clientOrderId,
  supportedOrderTypes,
} = {}) {
  if (!order || typeof order !== "object" || Array.isArray(order)) {
    throw new TypeError("createPendingCanonicalOrder requires an order object")
  }
  if (!(market instanceof Market)) {
    throw new TypeError("createPendingCanonicalOrder requires a canonical Market")
  }
  if (typeof clientOrderId !== "string" || !clientOrderId.trim()) {
    throw new TypeError("createPendingCanonicalOrder requires clientOrderId")
  }
  if (typeof order.symbol !== "string" || order.symbol.trim().toUpperCase() !== market.symbol) {
    throw new TypeError("Order symbol does not match the selected Market")
  }
  if (order.side !== "BUY" && order.side !== "SELL") {
    throw new TypeError("Conservative order side must be BUY or SELL")
  }
  const type = order.type ?? "LIMIT_MAKER"
  if (type !== "LIMIT" && type !== "LIMIT_MAKER") {
    throw new TypeError("Conservative strategy only supports LIMIT and LIMIT_MAKER orders")
  }
  if (!Array.isArray(supportedOrderTypes) || !supportedOrderTypes.includes(type)) {
    throw new Error("Exchange does not support order type " + type + " for " + market.symbol)
  }

  assertDecimalString({ value: order.quantity, field: "order.quantity" })
  assertDecimalString({ value: order.price, field: "order.price" })

  return new CanonicalOrder({
    clientOrderId: clientOrderId.trim(),
    market,
    side: order.side,
    type,
    limitPrice: new Money({
      amount: order.price,
      asset: market.quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: order.quantity,
      asset: market.baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: market.baseAsset,
    }),
    status: "PENDING",
  })
}
