/**
 * {@link https://www.binance.com/en/support/faq/how-to-test-my-functions-on-binance-testnet-ab78f9a1b8824cf0a106b4229c76496d}
 */

export function getBinanceConfig() {
  const {
    NODE_ENV,
    BINANCE_API_KEY,
    BINANCE_API_SECRET_KEY,
    BINANCE_SPOT_API_URL,
  } = process.env

  const config = {
    baseURL: BINANCE_SPOT_API_URL,
    apiKey: BINANCE_API_KEY,
    apiSecretKey: BINANCE_API_SECRET_KEY,
    wsURL: "wss://testnet.binance.vision/ws",
  }
  if (NODE_ENV === "production") {
    return {
      ...config,
      wsURL: "wss://stream.binance.com:9443",
    }
  }
  return config
}
