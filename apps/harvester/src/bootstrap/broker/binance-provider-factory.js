import { createBinanceBrokerAdapter } from "../../infrastructure/brokers/binance-broker-adapter.js"

export function resolveBinanceProviderConfig({ descriptor, env = process.env } = {}) {
  if (descriptor?.provider !== "binance") {
    throw new TypeError("Binance provider factory requires a Binance instance descriptor")
  }
  if (descriptor.tradingMode !== "testnet" && descriptor.tradingMode !== "live") {
    throw new TypeError(`Binance instance "${descriptor.id}" requires explicit testnet or live mode`)
  }
  const apiKeyName = descriptor.credentialEnv?.apiKey ?? "BINANCE_API_KEY"
  const apiSecretName = descriptor.credentialEnv?.apiSecret ?? "BINANCE_API_SECRET_KEY"
  const apiKey = env[apiKeyName]
  const apiSecret = env[apiSecretName]
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new TypeError(`Binance instance "${descriptor.id}" requires its configured API key environment variable`)
  }
  if (typeof apiSecret !== "string" || !apiSecret.trim()) {
    throw new TypeError(`Binance instance "${descriptor.id}" requires its configured API secret environment variable`)
  }
  return Object.freeze({
    apiKey,
    apiSecret,
    tradingMode: descriptor.tradingMode,
  })
}

export function createBinanceProviderFactory({ brokerAdapterFactory = createBinanceBrokerAdapter } = {}) {
  if (typeof brokerAdapterFactory !== "function") {
    throw new TypeError("Binance provider adapter factory must be a function")
  }
  return ({ descriptor, env = process.env, logger } = {}) => {
    const config = resolveBinanceProviderConfig({
      descriptor,
      env,
    })
    return brokerAdapterFactory({
      config,
      logger,
    })
  }
}
