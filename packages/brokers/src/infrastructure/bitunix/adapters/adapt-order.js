import { Order } from "@coinzilla/entities"
import { assertDecimalString, compareDecimal, subtractDecimal } from "@coinzilla/utils"

const SIDE_MAP = Object.freeze({
  "1": "SELL",
  "2": "BUY",
})
const TYPE_MAP = Object.freeze({
  "1": "LIMIT",
  "2": "MARKET",
})
const STATUS_MAP = Object.freeze({
  "1": "OPEN",
  "2": "FILLED",
  "3": "PARTIALLY_FILLED",
  "4": "CANCELED",
  "7": "PARTIALLY_FILLED_CANCELED",
})

function assertOrderQuantities({ volume, dealVolume }) {
  assertOrderQuantities({
    volume,
    dealVolume,
  })
  if (normalizedType === "LIMIT") {
    assertDecimalString({
      value: price,
      field: "Bitunix Spot limit price",
    })
  }
  const remainingQuantity = subtractDecimal({
    left: volume,
    right: dealVolume,
  })

  const order = new Order({
    type: normalizedType,
    side: normalizedSide,
    symbol: symbol.trim().toUpperCase(),
    quantity: Number(remainingQuantity),
    price: normalizedType === "MARKET" ? 0 : Number(price),
    id: String(orderId),
  })

  order.originalPrice = normalizedType === "MARKET" ? undefined : String(price)
  order.originalQuantity = String(volume)
  order.executedQuantity = String(dealVolume)
  order.remainingQuantity = remainingQuantity
  order.status = normalizedStatus
  order.createdAt = bitunixOrder.ctime
  order.updatedAt = bitunixOrder.utime

  return order
}
