import { adaptAggTrades } from "./adapters/adapt-trades.js"

const publicAdapters = new Map([
  ["aggTrade", adaptAggTrades],
])

const userDataEventTypes = new Set([
  "executionReport",
  "outboundAccountPosition",
  "account",
  "balanceUpdate",
  "listStatus",
])

/**
 * Adapt public market-data events only. Authenticated user-data events are
 * intentionally excluded and remain owned by the WebSocket API session.
 */
/**
 * Adapt a public market-data message; reject authenticated user-data events.
 *
 * @param {object} message - Raw Binance Spot stream event.
 * @returns {object} Normalized public event or the original event when no adapter exists.
 * @throws {TypeError} If the payload is invalid or belongs to the user-data API.
 */
export function adaptPublicStreamMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new TypeError("A public Binance stream event object is required")
  }

  if (userDataEventTypes.has(message.e)) {
    throw new TypeError("Authenticated user-data events are not public market-data events")
  }

  const adapter = publicAdapters.get(message.e)
  return adapter ? adapter(message) : message
}
