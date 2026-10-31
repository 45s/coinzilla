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
