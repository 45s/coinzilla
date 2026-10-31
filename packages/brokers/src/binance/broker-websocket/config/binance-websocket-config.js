import { isProdMode } from "@coinzilla/utils"
import { BINANCE_WEBSOCKET_ENDPOINTS } from "../constants/websocket-endpoints.js"

export class BinanceWebSocketConfig {
  constructor(input = {}) {
    const {
      apiKey,
      apiSecret,
      websocketApiUrl,
      websocketStreamsUrl,
      reconnectDelay = 5000,
    } = input

    if (typeof apiKey !== "string" || apiKey.length === 0 ||
        typeof apiSecret !== "string" || apiSecret.length === 0) {
      throw new Error("Binance API credentials are required")
    }

    if (!Number.isInteger(reconnectDelay) || reconnectDelay < 0) {
      throw new Error("reconnectDelay must be a non-negative integer")
    }

    const endpoints = isProdMode
      ? BINANCE_WEBSOCKET_ENDPOINTS.production
      : BINANCE_WEBSOCKET_ENDPOINTS.testnet

    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.websocketApiUrl = websocketApiUrl ?? endpoints.api
    this.websocketStreamsUrl = websocketStreamsUrl ?? endpoints.streams
    this.reconnectDelay = reconnectDelay
  }
}

export { BinanceWebSocketConfig as BinanceSdkConfig }

export { BINANCE_WEBSOCKET_ENDPOINTS } from "../constants/websocket-endpoints.js"
