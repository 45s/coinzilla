import { adaptAggTrades } from "./adapters/adapt-trades.js"
import { adaptKlineStreamMessage } from "./adapters/adapt-kline.js"

const publicAdapters = Object.freeze({
  aggTrade: adaptAggTrades,
  kline: adaptKlineStreamMessage,
})

const userDataEventTypes = Object.freeze([
  "executionReport",
  "outboundAccountPosition",
  "account",
  "balanceUpdate",
  "listStatus",
])

/**
 * Adapt a public market-data message; reject authenticated user-data events.
 *
 * @param {unknown} message - Raw Binance Spot stream event.
 * @returns {object} Normalized public event or the original event when no adapter exists.
 * @throws {TypeError} If the payload is invalid or belongs to the user-data API.
 */
export function adaptPublicStreamMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new TypeError("A public Binance stream event object is required")
  }

  if (userDataEventTypes.includes(message.e)) {
    throw new TypeError("Authenticated user-data events are not public market-data events")
  }

  const adapter = Object.hasOwn(publicAdapters, message.e)
    ? publicAdapters[message.e]
    : undefined
  return adapter ? adapter(message) : message
}
