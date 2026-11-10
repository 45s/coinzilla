export const BINANCE_WEBSOCKET_ENDPOINTS = Object.freeze({
  production: {
    api: "wss://ws-api.binance.com/ws-api/v3",
    streams: "wss://stream.binance.com:9443/ws",
  },
  testnet: {
    api: "wss://ws-api.testnet.binance.vision/ws-api/v3",
    streams: "wss://stream.testnet.binance.vision/ws",
  },
})
