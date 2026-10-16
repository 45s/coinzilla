import {
  Spot,
  SPOT_WS_API_TESTNET_URL,
  SPOT_WS_STREAMS_TESTNET_URL,
} from "@binance/spot"

const { BINANCE_API_KEY, BINANCE_API_SECRET_KEY } = process.env

if (!BINANCE_API_KEY || !BINANCE_API_SECRET_KEY) {
  throw new Error("Missing Binance credentials")
}

const client = new Spot({
  configurationWebsocketAPI: {
    apiKey: BINANCE_API_KEY,
    apiSecret: BINANCE_API_SECRET_KEY,
    wsURL: SPOT_WS_API_TESTNET_URL,
    reconnectDelay: 5000,
  },
  configurationWebsocketStreams: {
    wsURL: SPOT_WS_STREAMS_TESTNET_URL,
    reconnectDelay: 5000,
  },
})

export async function connectTrading() {
  return client.websocketAPI.connect()
}

export async function connectMarket() {
  return client.websocketStreams.connect()
}
