import { adaptAggTrades } from "../websocket-stream/adapters/adapt-trades.js"

const publicAdapters = {
  aggTrade: adaptAggTrades,
}

/**
 * Adapt public market-data events only. Authenticated user-data events are
 * intentionally excluded and remain owned by the WebSocket API session.
 */
export function adaptPublicStreamMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new TypeError("A public Binance stream event object is required")
  }

  const adapter = publicAdapters[message.e]
  return adapter ? adapter(message) : message
}
