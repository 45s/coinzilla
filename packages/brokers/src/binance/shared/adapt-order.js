import { Order } from "@coinzilla/entities"

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
  order.originalQuantity = String(origQty)
  order.executedQuantity = String(executedQty)
  order.status = binanceOrder.status

  return order
}
