import { Order } from "@coinzilla/entities"

export function adaptOrder(binanceOrder) {
  const { origQty, executedQty, price, orderId, type, side, symbol } =
    binanceOrder
  const quantity = +origQty - +executedQty
  if (quantity === 0) {
    throw new Error("quantity =+origQty - +executedQty === 0")
  }
  return new Order({
    type,
    side,
    symbol,
    quantity,
    price: +price,
    id: String(orderId),
  })
}
