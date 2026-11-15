const DEFAULT_WEBSOCKET_API_URL = "wss://openapi.bitunix.com:443/ws-api/v1"

/**
 * Validated Bitunix Spot WebSocket API configuration.
 * Bitunix's published Spot API documentation currently lists only the primary
 * production endpoint; no Spot TESTNET endpoint is assumed or synthesized.
 */
export class BitunixSpotConfig {
  /**
   * @param {{apiKey: string, apiSecret: string, tradingMode: "live", websocketApiUrl?: string, requestTimeout?: number}} input
   */
  constructor({
    apiKey,
    apiSecret,
    tradingMode,
    websocketApiUrl = DEFAULT_WEBSOCKET_API_URL,
    requestTimeout = 10_000,
  } = {}) {
    if (typeof apiKey !== "string" || !apiKey.trim() ||
        typeof apiSecret !== "string" || !apiSecret.trim()) {
      throw new TypeError("Bitunix Spot API credentials are required")
    }
    if (tradingMode !== "live") {
      throw new TypeError('Bitunix Spot tradingMode must be explicitly set to "live"; no Spot TESTNET endpoint is documented')
    }
    if (typeof websocketApiUrl !== "string" || !websocketApiUrl.startsWith("wss://")) {
      throw new TypeError("Bitunix Spot WebSocket API URL must use wss://")
    }
    if (!Number.isInteger(requestTimeout) || requestTimeout < 1) {
      throw new RangeError("Bitunix Spot requestTimeout must be a positive integer")
    }

    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.tradingMode = tradingMode
    this.websocketApiUrl = websocketApiUrl
    this.requestTimeout = requestTimeout
    Object.freeze(this)
  }
}

export { DEFAULT_WEBSOCKET_API_URL }
