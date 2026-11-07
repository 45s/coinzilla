import { Order } from "@coinzilla/entities"

/**
 * Adapt a Binance order response to the legacy broker Order entity.
 * Exact exchange price and quantity strings are retained on the returned order.
 *
 * @param {{origQty: string|number, executedQty: string|number, price: string|number, orderId: string|number, clientOrderId?: string, type: string, side: string, symbol: string, status: string}} binanceOrder
 * @returns {import("@coinzilla/entities").Order}
 */
export function adaptOrder(binanceOrder) {
  const {
    origQty,
    executedQty,
    price,
    orderId,
    clientOrderId,
    type,
    side,
    symbol,
  } = binanceOrder
  const quantity = +origQty - +executedQty
  const order = new Order({
    type,
    side,
    symbol,
    quantity,
    price: +price,
    id: String(orderId),
    ...(clientOrderId ? { clientOrderId } : {}),
  })

  // Keep exact exchange quantities and terminal status available to reconciliation.
  order.originalPrice = String(price)
  order.originalQuantity = String(origQty)
  order.executedQuantity = String(executedQty)
  order.status = binanceOrder.status

  return order
}
