import { Order } from "@coinzilla/entities"
import { assertDecimalString, compareDecimal, subtractDecimal } from "@coinzilla/utils"

const SIDE_MAP = Object.freeze({ "1": "SELL",
  "2": "BUY" })
const TYPE_MAP = Object.freeze({ "1": "LIMIT",
  "2": "MARKET" })
const STATUS_MAP = Object.freeze({
  "1": "OPEN",
  "2": "FILLED",
  "3": "PARTIALLY_FILLED",
  "4": "CANCELED",
  "7": "PARTIALLY_FILLED_CANCELED",
})

/**
 * Adapt a Bitunix Spot open/history order row to the legacy broker Order entity.
 *
 * @param {Record<string, unknown>} bitunixOrder
 * @returns {import("@coinzilla/entities").Order}
 */
export function adaptOrder(bitunixOrder) {
  if (!bitunixOrder || typeof bitunixOrder !== "object" || Array.isArray(bitunixOrder)) {
    throw new TypeError("Bitunix Spot order should be an object")
  }

  const {
    orderId,
    symbol,
    side,
    type,
    status,
    volume,
    dealVolume,
    price,
  } = bitunixOrder
  if ((typeof orderId !== "string" && typeof orderId !== "number") || String(orderId).trim() === "") {
    throw new TypeError("Bitunix Spot order is missing order ID")
  }
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError("Bitunix Spot order is missing symbol")
  }

  const normalizedSide = SIDE_MAP[String(side)]
  if (!normalizedSide) throw new TypeError("Bitunix Spot order side is unsupported")
  const normalizedType = TYPE_MAP[String(type ?? bitunixOrder.orderType)]
  if (!normalizedType) throw new TypeError("Bitunix Spot order type is unsupported")
  const normalizedStatus = STATUS_MAP[String(status)]
  if (!normalizedStatus) throw new TypeError("Bitunix Spot order status is unsupported")

  assertDecimalString({ value: volume,
    field: "Bitunix Spot original base quantity" })
  assertDecimalString({ value: dealVolume,
    field: "Bitunix Spot executed base quantity" })
  if (compareDecimal({ left: volume,
    right: "0" }) < 0 ||
      compareDecimal({ left: dealVolume,
        right: "0" }) < 0 ||
      compareDecimal({ left: dealVolume,
        right: volume }) > 0) {
    throw new TypeError("Bitunix Spot order quantities are outside the valid range")
  }
  if (normalizedType === "LIMIT") {
    assertDecimalString({ value: price,
      field: "Bitunix Spot limit price" })
  }
  const remainingQuantity = subtractDecimal({ left: volume,
    right: dealVolume })

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
