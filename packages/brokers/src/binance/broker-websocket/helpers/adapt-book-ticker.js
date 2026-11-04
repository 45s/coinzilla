import { assertDecimalString, compareDecimal } from "@coinzilla/utils"

export function adaptBookTickerMessage({ message, symbol, timestamp }) {
  if (!message || typeof message !== "object" || Array.isArray(message) ||
      (message.e !== undefined && message.e !== "bookTicker")) {
    throw new TypeError("A Binance bookTicker event is required")
  }
  if (message.s !== symbol) {
    throw new TypeError("Binance bookTicker symbol does not match the subscription")
  }

  const decimalFields = [
    ["b", "best bid price"],
    ["B", "best bid quantity"],
    ["a", "best ask price"],
    ["A", "best ask quantity"],
  ]
  for (const [field, name] of decimalFields) {
    assertDecimalString({ value: message[field], field: name })
    if (compareDecimal({ left: message[field], right: "0" }) <= 0) {
      throw new RangeError("Binance bookTicker " + name + " must be positive")
    }
  }

  return Object.freeze({
    symbol,
    bestBidPrice: message.b,
    bestBidQuantity: message.B,
    bestAskPrice: message.a,
    bestAskQuantity: message.A,
    timestamp,
  })
}
