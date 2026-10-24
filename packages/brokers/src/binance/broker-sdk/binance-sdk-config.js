import {
  SPOT_WS_API_PROD_URL,
  SPOT_WS_API_TESTNET_URL,
  SPOT_WS_STREAMS_PROD_URL,
  SPOT_WS_STREAMS_TESTNET_URL,
} from "@binance/spot"
import { isProdMode } from "@coinzilla/utils"

export class BinanceSdkConfig {
  constructor(input) {
    const {
      apiKey,
      apiSecret,
      websocketApiUrl,
      websocketStreamsUrl,
      reconnectDelay = 5000,
    } = input

    if (!apiKey || !apiSecret) {
      throw new Error("Binance API credentials are required")
    }

    if (!Number.isInteger(reconnectDelay) || reconnectDelay < 0) {
      throw new Error("reconnectDelay must be a non-negative integer")
    }

    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.websocketApiUrl =
      websocketApiUrl ??
      (isProdMode ? SPOT_WS_API_PROD_URL : SPOT_WS_API_TESTNET_URL)
    this.websocketStreamsUrl =
      websocketStreamsUrl ??
      (isProdMode ? SPOT_WS_STREAMS_PROD_URL : SPOT_WS_STREAMS_TESTNET_URL)
    this.reconnectDelay = reconnectDelay
  }
}
