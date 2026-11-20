import { BINANCE_WEBSOCKET_ENDPOINTS } from "../constants/websocket-endpoints.js"

/**
 * Validated Binance WebSocket endpoints and credentials.
 */
export class BinanceWebSocketConfig {
  /**
   * @param {{apiKey: string, apiSecret: string, tradingMode: "testnet" | "live", websocketApiUrl?: string, websocketStreamsUrl?: string, reconnectDelay?: number}} [input]
   * @throws {Error} If credentials, tradingMode, or reconnectDelay are invalid.
   */
  constructor(input = {}) {
    const {
      apiKey,
      apiSecret,
      tradingMode,
      websocketApiUrl,
      websocketStreamsUrl,
      reconnectDelay = 5000,
    } = input

    if (typeof apiKey !== "string" || apiKey.length === 0 ||
        typeof apiSecret !== "string" || apiSecret.length === 0) {
      throw new Error("Binance API credentials are required")
    }

    if (tradingMode !== "testnet" && tradingMode !== "live") {
      throw new Error('tradingMode must be set to "testnet" or "live"')
    }

    if (!Number.isInteger(reconnectDelay) || reconnectDelay < 0) {
      throw new Error("reconnectDelay must be a non-negative integer")
    }

    const endpoints = tradingMode === "live"
      ? BINANCE_WEBSOCKET_ENDPOINTS.production
      : BINANCE_WEBSOCKET_ENDPOINTS.testnet

    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.tradingMode = tradingMode
    this.websocketApiUrl = websocketApiUrl ?? endpoints.api
    this.websocketStreamsUrl = websocketStreamsUrl ?? endpoints.streams
    this.reconnectDelay = reconnectDelay
  }
}

export { BinanceWebSocketConfig as BinanceSdkConfig }

export { BINANCE_WEBSOCKET_ENDPOINTS } from "../constants/websocket-endpoints.js"
