import { Order } from "@coinzilla/entities"

export function adaptOrder(binanceOrder) {
  const { origQty, executedQty, price, orderId, type, side, symbol } =
    binanceOrder
  const quantity = +origQty - +executedQty
  return new Order({
    type,
    side,
    symbol,
    quantity,
    price: +price,
    id: String(orderId),
  })
}
